# Defeated Pieces Trays — Design Spec

## Goal

Add a "graveyard" UI below the game board showing all captured pieces for both players, organized like a physical Stratego board game's molded storage tray — one column per rank with the exact number of slots, defeated pieces filled in, blanks for what's still alive.

## Architecture

**Frontend-only feature.** No backend changes, no new Edge Functions, no schema changes. The `get_game_state` RPC already returns all pieces (alive and dead) with ranks visible for the player's own pieces and for any enemy piece that died in combat (revealed via `moves.attacker_rank`/`defender_rank`). The trays are rendered from this existing data in `game.js`.

## Components

### Layout

- Two collapsible tray sections below the game board, inside the `game-layout` flex container (underneath the board, not underneath the side panel).
- **Enemy Losses** on top, **Your Losses** below.
- Each tray has a clickable header bar with the label and a chevron toggle (▼ expanded, ▶ collapsed).
- Both start expanded by default. Collapse state is ephemeral (no persistence).

### Tray Content

- Horizontal layout: one column per rank type, ordered strongest to weakest then specials:
  - Ma (1), Ge (1), Co (2), Mj (3), Cp (4), Lt (4), Sg (4), Mi (5), Sc (8), Sp (1), B (6), F (1)
- Rank abbreviation label centered above each column.
- Thin vertical dividers between rank groups (between single-count and multi-count ranks, matching the mockup).
- Slot count per column matches `ARMY_COMPOSITION` from `src/rules/pieces.js`.

### Slot States

- **Defeated piece (filled):** Solid background with rank abbreviation. Green (`#a8c9a8` text on green bg) for your pieces, red (`#d98b8b` text on red bg) for enemy pieces — matching existing board cell colors.
- **Still alive (blank):** Dashed border, transparent background — indicates this piece is still on the board (or unrevealed for enemy).
- Slots fill from top to bottom within each column as pieces are captured.

### Data Flow

1. `game.js` already calls `get_game_state` and stores the result as piece rows with `piece_id`, `player_slot`, `rank`, `row_idx`, `col_idx`, `alive`, `is_mine`.
2. **Your dead pieces:** `rank` is always returned by `get_game_state` for your own pieces (alive or dead). Straightforward.
3. **Enemy dead pieces:** `get_game_state` returns `rank = null` for unrevealed enemy pieces. Since `revealed_rank` is no longer written on combat (per the fog-of-war fix), dead enemy pieces also have `rank = null`. However, every combat is recorded in the `moves` table with `attacker_rank` and `defender_rank`, and the move log query already fetches this data. The graveyard renderer must cross-reference each dead enemy `piece_id` against the moves data to recover the rank it had when it died. Specifically: find the move row where `piece_id` matches either the attacking or defending piece and the outcome killed it — the corresponding `attacker_rank` or `defender_rank` field gives the revealed rank.
4. A new `renderGraveyards(pieces, moves)` function filters for `alive === false`, resolves enemy ranks from moves data, groups by rank, and renders the tray HTML.
5. Called from `refreshState()` alongside the existing `renderBoard()` call, so it updates whenever the board updates (including on Realtime events).

### Responsive

- On narrow screens (<700px), each tray gets `overflow-x: auto` for horizontal scrolling, matching how the board already handles narrow viewports.

## Files Changed

- `web/game.html` — add two graveyard container `<div>`s below the board div, inside `game-layout`.
- `web/js/game.js` — add `renderGraveyards()` function, call it from `refreshState()`.
- `web/css/styles.css` — add graveyard tray styles (`.graveyard`, `.graveyard-header`, `.graveyard-body`, `.graveyard-column`, `.graveyard-slot`, `.graveyard-slot.filled`, `.graveyard-slot.empty`).

## Non-Goals

- No animation on piece capture (pieces just appear in the tray on next render).
- No click interaction on graveyard pieces (they're display-only).
- No persistence of collapse state across page reloads.
- No changes to the move log or any other existing UI.
