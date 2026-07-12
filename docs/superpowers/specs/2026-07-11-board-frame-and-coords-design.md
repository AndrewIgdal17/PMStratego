# Board Frame & Grid Coordinates — Design Spec

## Goal

Give the game board a thick beveled wooden frame with Battleship-style grid coordinates (A–J columns, 1–10 rows), and update the move log to use those same human-readable coordinates with fog-of-war-respecting piece names.

## Architecture

Frontend-only. No backend changes. The board gets a wrapper div for the frame, labels are HTML elements in the frame margins, and `game.js` adds a coordinate conversion helper used by both `renderBoard()` and `refreshMoveLog()`.

## Board Frame

### Visual treatment

- A wrapper div (`.board-frame`) surrounds the existing `.board` grid.
- The wrapper uses a CSS gradient (`linear-gradient(135deg, ...)`) across warm wood tones for a beveled, physical feel.
- Generous padding (~14-16px) on the frame to hold coordinate labels.
- Outer `box-shadow` for depth/lift off the page background.
- Inner highlight (`inset 0 1px 0 rgba(255,255,255,0.15)`) on the frame for top-edge bevel.
- The grid itself sits inside with `box-shadow: inset 0 2px 8px rgba(0,0,0,0.6)` for a carved-out inset look.

### Labels

- **Columns:** A through J, rendered as a row of elements above the grid, inside the frame padding.
- **Rows:** 1 through 10, rendered as a column of elements to the left of the grid, inside the frame padding.
- Labels styled with the wood-light color (`#c9a876`), bold, with `text-shadow` for an "etched into wood" feel.
- Labels are from the **player's perspective:** row 1 is always the player's back row (nearest to them), row 10 is the enemy's back row. Column A is always the player's left. Since slot 2's board is already rotated 180° via `toAbsolute()`, the labels just count 1–10 top-to-bottom and A–J left-to-right from display coordinates — no extra mirroring needed.

### Responsive

- On mobile (<700px), the frame padding and label font size shrink proportionally.

## Coordinate System

### Display coordinate helper

A new function `toDisplayCoord(absoluteRow, absoluteCol)` converts absolute board coordinates to player-perspective Battleship-style strings:

- For slot 1: display row = `absoluteRow - playerBackRow + 1`, display col = letter from `absoluteCol`
- For slot 2: board is already rotated, so the inverse of `toAbsolute` gives the display position, then map to letter + number.
- Returns a string like `"C4"` or `"J10"`.

Alternatively, since `renderBoard()` already iterates in display order (displayRow 0–9, displayCol 0–9), the simpler approach: `toDisplayCoord(displayRow, displayCol)` → column letter = `String.fromCharCode(65 + displayCol)` (A–J), row number = `displayRow + 1` (1–10). The move log needs the inverse: given absolute coords from the DB, convert to display coords for the current player's perspective.

### Move log conversion

`refreshMoveLog()` converts each move's absolute `from_row, from_col, to_row, to_col` to display coordinates before rendering. This requires the inverse of `toAbsolute`:

```
function toDisplay(absRow, absCol) {
  if (mySlot === 2) {
    return { row: BOARD_SIZE - 1 - absRow, col: BOARD_SIZE - 1 - absCol };
  }
  return { row: absRow, col: absCol };
}
```

Then format as `String.fromCharCode(65 + displayCol) + (displayRow + 1)`.

## Move Log Format

### Fog-of-war rules

- **Your moves (non-combat):** `"[PieceName] [from] → [to]"` — e.g. `"Marshal A1 → A2"`
- **Opponent/Bot moves (non-combat):** `"[from] → [to]"` — e.g. `"J5 → J6"` (no piece name, fog of war)
- **Combat (any player):** `"[from] → [to] ([AttackerName] vs [DefenderName]: [outcome])"` — e.g. `"A3 → A4 (Marshal vs Scout: ATTACKER_WINS)"` — combat always reveals both pieces, so names are shown for both players' moves.

### Piece name source

- **Combat moves (either player):** Use `RANK_NAME[m.attacker_rank]` and `RANK_NAME[m.defender_rank]` — already in the moves query.
- **Your non-combat moves:** Add `piece_id` to the moves query select (currently missing). Look up rank via `piecesById.get(m.piece_id)?.rank` — `piecesById` always has rank for your own pieces regardless of current position. Then `RANK_NAME[rank]` for the display name.
- **Opponent non-combat moves:** No piece name shown (fog of war). Just coordinates.

## Files Changed

- `web/game.html` — wrap `#board` in a `.board-frame` div, add label container divs for column headers and row labels
- `web/css/styles.css` — `.board-frame` gradient/shadow/padding, `.board-col-labels` and `.board-row-labels` layout, updated `.board` to remove its own border (frame provides it), responsive adjustments
- `web/js/game.js` — `renderBoard()` populates label elements, new `toDisplay(absRow, absCol)` and `formatCoord(displayRow, displayCol)` helpers, `refreshMoveLog()` uses display coords + fog-of-war piece name logic, moves query adds `piece_id` to select

## Non-Goals

- No changes to the game rules or backend.
- No changes to how the setup grid looks (setup uses its own grid, not the game board).
- No coordinate overlay on hover (just static edge labels).
