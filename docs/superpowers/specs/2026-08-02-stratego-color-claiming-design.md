# Design: Color claiming & synced token color

**Date:** 2026-08-02
**Status:** Approved by user, ready for implementation plan

## Problem

Today each player's army color is a purely local, one-directional `localStorage` preference. Enemy pieces are *always* rendered in a hardcoded "enemy red" (`ENEMY_COLOR` in `token.js`), regardless of what color the opponent actually picked — the opponent's choice is invisible to you. The user wants: (1) colors to be mutually exclusive between the two players in a room, and (2) each player's actual chosen color to be visible to the other player everywhere their pieces are shown.

## Current state (verified in code)

- `web/js/setup.js` `PLAYER_COLORS` — 8-swatch palette, `initColorPicker()` writes directly to `localStorage.setItem('stratego:<room>:color', hex)` on click. No server round-trip.
- `web/js/token.js` — `createTokenSVG(rank, isMine, playerColor)`: `isMine` pieces use `playerColor` (the local player's own choice); all other pieces use the module-level constant `ENEMY_COLOR = '#8b4444'`.
- `web/js/game.js` `getPlayerColor()` reads the same localStorage key; used for "mine" board pieces and the "mine" graveyard tray swatch (`slot.style.backgroundColor`).
- `games` table already carries per-game cosmetic/config fields set this same way: `bot_difficulty`, `bot_personality` (`supabase/migrations/0007`, `0008`), each with a dedicated `set-*` Edge Function following an identical shape (validate token → validate game state/slot → validate value → update `games` row). `games` is in the Realtime publication and already drives `setup.js`'s "go refetch state" refresh, plus a 5s polling fallback (2026-07-31 fix).
- `get_game_state(p_token)` (`supabase/migrations/0001_init.sql`) returns only piece rows today — no color info.

## Design

### Data model

Add two nullable columns to `games` (migration `0016_player_colors.sql`):

```sql
alter table games add column player1_color text;
alter table games add column player2_color text;
```

Store the hex string directly (matches how the client already keys colors by hex, not an index/enum — no new lookup table needed). `null` = not yet claimed (falls back to neutral gray on render, see below).

### Auto-seed on join

To avoid a "nobody has picked yet" state ever blocking anything: when a game is created (`create-game`) and when the second player joins (`join-game`), seed that slot's color column with the first palette color not already taken by the other slot (usually just `PLAYER_COLORS[0]` for slot 1, and `PLAYER_COLORS[1]` for slot 2 if slot 1 already has `PLAYER_COLORS[0]`). This is a pure default — the player can still change it via `set-color` before submitting setup.

### `set-color` Edge Function

New function, same shape/pattern as `set-bot-difficulty`:

1. Look up `game_players` by `secret_token` → `game_id`, `player_slot`.
2. Load `games` row (`status`, `player1_color`, `player2_color`).
3. Reject (`409 NOT_ALLOWED`) if `status !== 'setup'` — colors lock once play starts (matches "once play happens both see each other as the selected color," i.e., it must be settled before turns begin).
4. Reject (`400 INVALID_COLOR`) if the requested hex isn't in the known 8-swatch palette (server-side copy of `PLAYER_COLORS` hexes, kept in sync with the client list — small enough to duplicate rather than fetch cross-repo).
5. Reject (`409 COLOR_TAKEN`) if the *other* slot's color column already equals the requested hex. Re-submitting your own current color is always allowed (no-op success).
6. Update the caller's own color column (`player1_color` or `player2_color` based on `player_slot`) and `updated_at`.

This check-then-write happens against the live DB row inside the function, so if both players click the same never-before-taken color within the same instant, whichever request's `update` executes first "wins" — the second request re-reads and sees the color now taken, and gets rejected. No client-side race window.

### Client (`setup.js`)

- Clicking a swatch calls `set-color` immediately — this *is* the commit action, there's no separate "confirm" step, matching the existing single-click UX.
- On success: update the swatch selection UI, and (like today) call `renderGrid()` to reflect the new color on already-placed pieces.
- On `409 COLOR_TAKEN`: flash the clicked swatch red/shake briefly with a "Taken by opponent" tooltip, then revert to the previously-selected swatch. Do not change local color state.
- Palette rendering: on load and on every state refresh (existing polling/Realtime refresh path), disable (grayed out, unclickable, "Taken" tooltip) any swatch matching the opponent's *currently committed* server-side color. This is a real commit, not a live hover-preview — there's no hover-preview concept in this UI today, so nothing changes there.
- Stale default handling: on page load, if the player's remembered `localStorage` default color is already the opponent's committed color for this room, silently fall through and select the first free palette color instead — no error shown, no explanation needed since the player never explicitly re-chose it this session.

### Rendering (`token.js`, `game.js`, graveyard trays)

- Retire the `ENEMY_COLOR` constant and the `isMine ? playerColor : ENEMY_COLOR` branch in `createTokenSVG`. Replace with: caller always passes the *actual* color for whichever player owns the piece (mine → my committed color, theirs → their committed color, sourced from `get_game_state`'s new color fields).
- `get_game_state` return type gains `mine_color text` and `enemy_color text` (or simpler: return the raw `player1_color`/`player2_color` alongside a `my_slot` indicator the client already effectively has via `is_mine` per piece — simplest is to just add both color columns to every returned row, redundant but trivial and consistent with the function's existing per-row shape). Colors are not secret info (no fog-of-war implication), so no redaction needed.
- If the opponent hasn't committed a color yet at the moment of render (should be rare given auto-seeding, but possible mid-race), fall back to a neutral gray (`#6a6a6a`-ish) rather than red — red no longer means "enemy," it's genuinely nobody's color yet.
- Graveyard tray `slot.style.backgroundColor` for the enemy side gets the same treatment (currently hardcoded via CSS class `filled-enemy`; needs to become dynamic like the "mine" side already is).
- Move log / any other place a player color chip appears gets the corresponding player's real color instead of a fixed enemy red.

## Testing

- Unit test (Deno, `set-color/index.test.ts` if project convention has per-function tests, else integration-style curl smoke test matching `set-bot-difficulty`'s existing verification pattern): own-repick allowed, opponent-taken rejected, non-setup-status rejected, invalid hex rejected.
- Two-context Playwright test: player A picks a color, assert player B's swatch list shows it disabled within one poll/Realtime cycle; assert player B's board immediately after setup shows player A's pieces in A's actual chosen color, not red.

## Out of scope / deferred

- No spectator-specific color handling (spectator mode exists per `0003_spectator.sql`; spectators just render whatever both players' committed colors are, no special-casing needed since they're pure read-only viewers).
- No expansion of the 8-color palette — 2 players only ever need 2 distinct colors; the extra 6 are just player choice/variety, not a slot-count requirement.
