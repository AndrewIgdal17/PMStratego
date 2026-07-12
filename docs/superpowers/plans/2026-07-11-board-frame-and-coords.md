# Board Frame & Grid Coordinates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a thick beveled wooden frame around the game board with Battleship-style grid coordinates (A–J columns, 1–10 rows), and update the move log to use those coordinates with fog-of-war-respecting piece names.

**Architecture:** Frontend-only. Board gets a frame wrapper in HTML, labels rendered by JS alongside the board, coordinate conversion helpers shared between `renderBoard()` and `refreshMoveLog()`.

**Tech Stack:** Plain JavaScript (ESM), CSS.

**Design reference:** `docs/superpowers/specs/2026-07-11-board-frame-and-coords-design.md`

---

## Task 1: Add board frame HTML structure and CSS

**Files:**
- Modify: `web/game.html`
- Modify: `web/css/styles.css`

- [ ] **Step 1: Wrap the board in a frame container in game.html**

In `web/game.html`, replace:

```html
        <div id="board" class="board"></div>
```

with:

```html
        <div class="board-frame">
          <div class="board-col-labels" id="board-col-labels"></div>
          <div class="board-inner">
            <div class="board-row-labels" id="board-row-labels"></div>
            <div id="board" class="board"></div>
          </div>
        </div>
```

- [ ] **Step 2: Add board frame CSS**

In `web/css/styles.css`, find the existing `.board` rule:

```css
.board {
  display: grid;
  gap: 2px;
  flex: 1;
  background: var(--wood-dark);
  padding: 4px;
  border-radius: 4px;
  border: 2px solid var(--wood-mid);
}
```

Replace it with the frame + board rules:

```css
.board-frame {
  background: linear-gradient(135deg, #8a6a3f 0%, #6a5030 30%, #5a4020 70%, #8a6a3f 100%);
  padding: 6px 14px 14px 6px;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.3);
}

.board-col-labels {
  display: flex;
  padding-left: 24px;
  margin-bottom: 2px;
}

.board-col-labels span {
  flex: 1;
  text-align: center;
  font-size: 0.7rem;
  font-weight: bold;
  color: var(--wood-light);
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.board-inner {
  display: flex;
}

.board-row-labels {
  display: flex;
  flex-direction: column;
  width: 24px;
  flex-shrink: 0;
}

.board-row-labels span {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: bold;
  color: var(--wood-light);
  text-shadow: 0 1px 2px rgba(0,0,0,0.5);
}

.board {
  display: grid;
  gap: 2px;
  flex: 1;
  background: var(--wood-dark);
  padding: 4px;
  border-radius: 2px;
  border: none;
  box-shadow: inset 0 2px 8px rgba(0,0,0,0.6);
}
```

Also update the `.game-layout .board` grid placement rule — find:

```css
.game-layout .board {
  grid-column: 1;
  grid-row: 1;
}
```

Replace with:

```css
.game-layout .board-frame {
  grid-column: 1;
  grid-row: 1;
}
```

- [ ] **Step 3: Commit**

```bash
git add web/game.html web/css/styles.css
git commit -m "feat: add thick beveled wooden frame around the game board"
```

---

## Task 2: Render coordinate labels from JS and add conversion helpers

**Files:**
- Modify: `web/js/game.js`

- [ ] **Step 1: Add coordinate conversion helpers**

In `web/js/game.js`, after the existing `toAbsolute` function (around line 273), add:

```javascript
function toDisplay(absRow, absCol) {
  if (mySlot === 2) {
    return { row: BOARD_SIZE - 1 - absRow, col: BOARD_SIZE - 1 - absCol };
  }
  return { row: absRow, col: absCol };
}

function formatCoord(displayRow, displayCol) {
  return String.fromCharCode(65 + displayCol) + (displayRow + 1);
}

function formatAbsCoord(absRow, absCol) {
  const d = toDisplay(absRow, absCol);
  return formatCoord(d.row, d.col);
}
```

- [ ] **Step 2: Populate the label elements in renderBoard()**

At the beginning of the `renderBoard()` function, before the existing `board.innerHTML = ""` line, add the label rendering:

```javascript
  const colLabels = document.getElementById("board-col-labels");
  if (colLabels) {
    colLabels.innerHTML = "";
    for (let c = 0; c < BOARD_SIZE; c++) {
      const span = document.createElement("span");
      span.textContent = String.fromCharCode(65 + c);
      colLabels.appendChild(span);
    }
  }

  const rowLabels = document.getElementById("board-row-labels");
  if (rowLabels) {
    rowLabels.innerHTML = "";
    for (let r = 0; r < BOARD_SIZE; r++) {
      const span = document.createElement("span");
      span.textContent = String(r + 1);
      rowLabels.appendChild(span);
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add web/js/game.js
git commit -m "feat: render A-J/1-10 coordinate labels on the board frame"
```

---

## Task 3: Update move log to use display coordinates and fog-of-war piece names

**Files:**
- Modify: `web/js/game.js`

- [ ] **Step 1: Add piece_id to the moves query**

In `refreshMoveLog`, find the existing select:

```javascript
    .select("move_number, player_slot, from_row, from_col, to_row, to_col, move_type, outcome, attacker_rank, defender_rank")
```

Change it to:

```javascript
    .select("move_number, player_slot, piece_id, from_row, from_col, to_row, to_col, move_type, outcome, attacker_rank, defender_rank")
```

- [ ] **Step 2: Rewrite the move log rendering loop**

In `refreshMoveLog`, replace the entire `for (const m of data)` loop (including the existing `li` creation logic) with:

```javascript
  for (const m of data) {
    const li = document.createElement("li");
    const who = m.player_slot === mySlot ? "You" : (gameRow?.is_bot_game ? "Bot" : "Opponent");
    const fromCoord = formatAbsCoord(m.from_row, m.from_col);
    const toCoord = formatAbsCoord(m.to_row, m.to_col);
    const isMyMove = m.player_slot === mySlot;

    if (m.move_type === "attack") {
      li.textContent = `${who}: ${fromCoord} → ${toCoord} (${RANK_NAME[m.attacker_rank] ?? m.attacker_rank} vs ${RANK_NAME[m.defender_rank] ?? m.defender_rank}: ${m.outcome})`;
    } else if (isMyMove) {
      const piece = piecesById.get(m.piece_id);
      const pieceName = piece ? (RANK_NAME[piece.rank] ?? '') : '';
      li.textContent = `${who}: ${pieceName ? pieceName + ' ' : ''}${fromCoord} → ${toCoord}`;
    } else {
      li.textContent = `${who}: ${fromCoord} → ${toCoord}`;
    }
    list.appendChild(li);
  }
```

Key changes:
- Uses `formatAbsCoord` for display coordinates instead of raw `from_row,from_col`
- Uses `→` instead of `->` for visual polish
- Your non-combat moves: shows piece name from `piecesById` lookup
- Opponent non-combat moves: just coordinates (fog of war)
- Combat: always shows both piece names (combat reveals both)

- [ ] **Step 3: Commit**

```bash
git add web/js/game.js
git commit -m "feat: move log uses Battleship coordinates with fog-of-war piece names"
```

---

## Task 4: Push and verify

**Files:** none (deploy + verification only)

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

- [ ] **Step 2: Local verification with Playwright**

Start the local server if not running:

```bash
npx http-server web -p 8090 -s
```

Write and run a Playwright script against `http://localhost:8090` that:

1. Opens home, clicks "Play vs Bot".
2. On setup, clicks "Defensive", submits.
3. On the game page, confirms `.board-frame` exists.
4. Confirms `.board-col-labels` has 10 `<span>` children with text A through J.
5. Confirms `.board-row-labels` has 10 `<span>` children with text 1 through 10.
6. Makes one move, confirms the move log entry uses letter+number format (regex match for something like `You: [A-J]\d+ → [A-J]\d+`).
7. Takes a screenshot of the framed board.

- [ ] **Step 3: Commit any fixes**

If the verification reveals issues, fix and push again.

---

## Self-review notes

- **Spec coverage:** Thick beveled frame ✓. A–J/1–10 labels ✓. Labels in player perspective ✓. Move log with display coords ✓. Fog-of-war piece names (yours shown, opponent hidden, combat both shown) ✓. `piece_id` added to moves query ✓. Responsive noted but deferred to CSS inheriting from existing mobile rules ✓.
- **No placeholders:** All code blocks complete.
- **Type/name consistency:** `toDisplay(absRow, absCol)` is the inverse of `toAbsolute(displayRow, displayCol)` — both use the same mirroring logic. `formatCoord(displayRow, displayCol)` returns a string. `formatAbsCoord(absRow, absCol)` composes both. All three defined in Task 2, used in Task 3. `RANK_NAME` already exists in the file — no redefinition needed.
