# Design: Private saved formations + L/R mirror

**Date:** 2026-08-02
**Status:** Approved by user, ready for implementation plan

## Problem

The setup screen already lets players cycle through 28 *public* published Stratego opening formations (Defensive/Aggressive buttons, `web/js/formations.js`). There's no way for a player to save their *own* custom placement and reload it in a future game. The user wants 5 private formation slots per player, plus a one-click left-right mirror for whatever's currently on the grid.

## Current state (verified in code)

- `web/js/setup.js`: `placements` is an in-memory `Map` of `"row,col"` → `rank` string, built by manual clicks or by `applyFormation(name)`, which reads a formation's `cells: [[row, col, rank], ...]` array (from `DEFENSIVE_FORMATIONS`/`AGGRESSIVE_FORMATIONS` in `formations.js`) and re-maps local rows to each slot's absolute rows via `ABSOLUTE_ROWS_BY_SLOT` (`formationRowMap.js`).
- `web/js/auth.js` already provides a working JWT session (signup/login, `players` table, `0009_player_accounts.sql`) used by `profile.js` — this is the account system to hang private formations off of.
- The game itself requires **no login** to play (room code + secret token model, by original design decision) — player accounts are an optional bolt-on added later for stats/Elo. This feature is the first thing to require login to use.

## Design

### Access gate

- Anonymous players (no active session in `auth.js`) see the "My Formations" panel in a locked state: a lock icon + "Log in to save your own formations" link that opens the existing login/signup modal. The existing public Defensive/Aggressive preset buttons are completely unaffected and remain available to everyone regardless of login state.
- Once logged in, the panel unlocks in place (no page reload needed — same pattern `auth.js` already uses to swap the nav login button for a profile link on session change).

### Data model

New table (migration `0016_player_formations.sql` — or next free number after whatever the color-claiming spec's migration lands as, sequenced at plan time):

```sql
create table player_formations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  cells jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, name)
);

alter table player_formations enable row level security;
-- no client policies: same "server-side only" pattern as game_players/pieces —
-- all access goes through JWT-authenticated Edge Functions using the service role.
```

`cells` stores the exact same `[[row, col, rank], ...]` shape already used by `DEFENSIVE_FORMATIONS`, keyed to the player's own local row/col convention (0-3 rows × 0-9 cols, same as what `setup.js` already produces from `placements` before the `ABSOLUTE_ROWS_BY_SLOT` remap) — so loading a saved formation reuses the exact same `applyFormation`-style remap code path as loading a public preset, no new placement logic needed.

The 5-slot cap is enforced in the Edge Function, not a DB constraint (simpler, consistent with how this project already validates business rules in Edge Functions rather than triggers — e.g. `set-bot-difficulty`'s allowed-value check).

### Edge Functions

- **`save-formation`** — body: `{ authToken, name, cells }`.
  1. Verify JWT via existing `_shared/auth.ts`, get `player_id`.
  2. If a row with this exact `name` already exists for this player, `update` it (overwrite semantics — same name = intentional replace).
  3. Else, count existing rows for this player; if `>= 5`, reject `409 SLOT_LIMIT_REACHED` with the existing 5 names in the response so the client can prompt "delete one first."
  4. Else `insert`.
- **`list-formations`** — body: `{ authToken }`. Returns the caller's own formations (id, name, cells), ordered by `updated_at desc`. Used to populate the slot buttons on setup screen load.
- **`delete-formation`** — body: `{ authToken, id }`. Deletes one row owned by the caller (ownership checked via `player_id` match, not just trusting the client-supplied id).

### Client (`setup.js`)

- New "My Formations" section, visually alongside the existing Defensive/Aggressive preset buttons (same button-row pattern).
- On load (if logged in): call `list-formations`, render up to 5 named buttons. Click = load (same remap + `renderGrid()` call as `applyFormation`).
- A "Save current as…" button: prompts for a name (simple inline text input, not a browser `prompt()` — matches existing modal patterns in `auth.js`), reads the current `placements` Map, converts to the `cells` array, calls `save-formation`.
- If `save-formation` returns `SLOT_LIMIT_REACHED`: show the 5 existing names with a trash-can icon next to each so the player can delete one inline without losing their current unsaved grid state, then retry the save.
- Each loaded slot button also gets a small trash icon (visible once logged in and slots exist) calling `delete-formation` directly, for cleanup outside the save flow.

### L/R mirror button

- New button next to the placement grid, e.g. "⇄ Mirror L/R."
- Pure client-side, no server round-trip, no new data model.
- On click: build a new `Map` where every `"row,col"` key becomes `"row,${9-col}"` (column-only reflection across the vertical centerline of the player's own 4×10 setup zone — rows/ranks unchanged), then `renderGrid()`.
- Works identically regardless of how the current grid was populated (manual clicks, a public preset, or a loaded private formation) since it only operates on the current in-memory `placements` state.
- Idempotent/reversible: clicking again mirrors back to the original layout. Not persisted anywhere — purely a live transform button, matching how "Clear" already works as a stateless action on `placements`.

## Testing

- Unit test: `save-formation` overwrite-by-name, 5-slot rejection with correct existing-names payload, `delete-formation` ownership check (can't delete another player's formation by id).
- Unit test (pure function, extractable like `formationRowMap.js`'s existing pattern): mirror transform correctness — a known placement mirrors to the expected column set, double-mirror returns the original.
- Playwright: logged-in player saves a formation, reloads setup page, loads it back, placements match; anonymous player sees the locked panel and public presets still work.

## Out of scope / deferred

- No cross-player sharing/import of formations (each player's 5 are strictly private, matching the ask).
- No formation preview thumbnails in the slot buttons (name-only for v1; could add a small mini-grid render later as a pure enhancement).
