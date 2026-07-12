# Defeated Pieces Trays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add collapsible "graveyard" trays below the game board showing defeated pieces for both players, organized by rank like a physical board game storage tray.

**Architecture:** Frontend-only — no backend changes. `get_game_state` already returns all pieces (alive and dead). Your own dead pieces have ranks visible; enemy dead pieces have `rank = null` but their ranks can be recovered from the `moves` table's `attacker_rank`/`defender_rank` fields. A new `renderGraveyards()` function in `game.js` renders two collapsible tray sections (enemy on top, yours below) below the board.

**Tech Stack:** Plain JavaScript (ESM), CSS. No new dependencies.

**Design reference:** `docs/superpowers/specs/2026-07-11-defeated-pieces-trays-design.md`

---

## Task 1: Add graveyard HTML containers and CSS

**Files:**
- Modify: `web/game.html`
- Modify: `web/css/styles.css`

- [ ] **Step 1: Add graveyard container divs to game.html**

In `web/game.html`, add two graveyard containers after the `<div id="board" class="board"></div>` line (still inside `game-layout`, before the `<aside class="side-panel">`):

```html
        <div id="board" class="board"></div>
        <div class="graveyards-area">
          <div class="graveyard" id="graveyard-enemy">
            <div class="graveyard-header" data-target="graveyard-enemy-body">
              <span class="graveyard-label enemy-label">Enemy Losses</span>
              <span class="graveyard-chevron">▼</span>
            </div>
            <div class="graveyard-body" id="graveyard-enemy-body"></div>
          </div>
          <div class="graveyard" id="graveyard-mine">
            <div class="graveyard-header" data-target="graveyard-mine-body">
              <span class="graveyard-label back-label">Your Losses</span>
              <span class="graveyard-chevron">▼</span>
            </div>
            <div class="graveyard-body" id="graveyard-mine-body"></div>
          </div>
        </div>
```

The existing `<aside class="side-panel">` stays exactly where it is, right after this new block.

- [ ] **Step 2: Update game-layout CSS so graveyards sit below the board**

The current `.game-layout` is `display: flex` (horizontal: board + side panel). The graveyards need to sit below the board but not below the side panel. Wrap the board and graveyards in a column flex, keeping the side panel alongside.

Change `game-layout` in `web/css/styles.css` from:

```css
.game-layout {
  display: flex;
  gap: 1rem;
}
```

to:

```css
.game-layout {
  display: flex;
  gap: 1rem;
}

.graveyards-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 0.75rem;
}
```

But this alone won't make the board and graveyards stack vertically while the side panel stays alongside. We need a wrapper. Update `game.html` so the board + graveyards are wrapped together:

Actually, simpler approach — use CSS `order` and `flex-wrap`. The cleanest solution: change the `game-layout` to use CSS grid instead of flex, with the board and graveyards in the left column and the side panel in the right column.

Replace the `game-layout` rule and add graveyards styles in `web/css/styles.css`:

```css
.game-layout {
  display: grid;
  grid-template-columns: 1fr 280px;
  grid-template-rows: auto auto;
  gap: 1rem;
}

.game-layout .board {
  grid-column: 1;
  grid-row: 1;
}

.graveyards-area {
  grid-column: 1;
  grid-row: 2;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.game-layout .side-panel {
  grid-column: 2;
  grid-row: 1 / 3;
}
```

And update the mobile breakpoint — change the existing:

```css
@media (max-width: 700px) {
  .game-layout {
    flex-direction: column;
  }
  .side-panel {
    width: 100%;
    min-width: unset;
  }
}
```

to:

```css
@media (max-width: 700px) {
  .game-layout {
    grid-template-columns: 1fr;
  }
  .game-layout .side-panel {
    grid-column: 1;
    grid-row: auto;
  }
  .graveyards-area {
    grid-column: 1;
    grid-row: auto;
  }
  .side-panel {
    width: 100%;
    min-width: unset;
  }
}
```

- [ ] **Step 3: Add graveyard component CSS**

Append these styles to the end of `web/css/styles.css` (before the mobile media query):

```css
/* ── Defeated pieces graveyards ── */

.graveyard {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--wood-mid);
  border-radius: 6px;
  overflow: hidden;
}

.graveyard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid rgba(138, 106, 63, 0.3);
}

.graveyard-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.graveyard.collapsed .graveyard-header {
  border-bottom: none;
}

.graveyard-label {
  font-weight: bold;
  font-size: 0.85rem;
}

.graveyard-chevron {
  color: var(--wood-light);
  font-size: 0.9rem;
  transition: transform 0.15s;
}

.graveyard.collapsed .graveyard-chevron {
  transform: rotate(-90deg);
}

.graveyard.collapsed .graveyard-body {
  display: none;
}

.graveyard-body {
  padding: 8px 12px;
  overflow-x: auto;
}

.graveyard-tray {
  display: flex;
  gap: 4px;
  align-items: flex-start;
}

.graveyard-divider {
  width: 1px;
  background: rgba(138, 106, 63, 0.3);
  align-self: stretch;
  margin: 0 2px;
}

.graveyard-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.graveyard-rank-label {
  color: var(--wood-light);
  font-size: 0.5rem;
  font-weight: bold;
  opacity: 0.7;
}

.graveyard-slot {
  width: 28px;
  height: 28px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.55rem;
  font-weight: bold;
}

.graveyard-slot.empty-mine {
  background: rgba(168, 201, 168, 0.12);
  border: 1px dashed rgba(168, 201, 168, 0.3);
}

.graveyard-slot.empty-enemy {
  background: rgba(217, 139, 139, 0.12);
  border: 1px dashed rgba(217, 139, 139, 0.3);
}

.graveyard-slot.filled-mine {
  background: #a8c9a8;
  color: #1a3a1a;
}

.graveyard-slot.filled-enemy {
  background: #d98b8b;
  color: #3a1a1a;
}
```

- [ ] **Step 4: Commit**

```bash
git add web/game.html web/css/styles.css
git commit -m "feat: add graveyard HTML containers and CSS for defeated pieces trays"
```

---

## Task 2: Implement renderGraveyards() and wire it into the refresh cycle

**Files:**
- Modify: `web/js/game.js`

- [ ] **Step 1: Add the ARMY_COMPOSITION constant and renderGraveyards function**

At the top of `web/js/game.js`, after the existing `RANK_NAME` map (line 21), add:

```javascript
const GRAVEYARD_RANKS = [
  { rank: '1',    abbr: 'Ma', count: 1 },
  { rank: '2',    abbr: 'Ge', count: 1 },
  { rank: '3',    abbr: 'Co', count: 2 },
  { rank: '4',    abbr: 'Mj', count: 3 },
  { rank: '5',    abbr: 'Cp', count: 4 },
  { rank: '6',    abbr: 'Lt', count: 4 },
  { rank: '7',    abbr: 'Sg', count: 4 },
  { rank: '8',    abbr: 'Mi', count: 5 },
  { rank: '9',    abbr: 'Sc', count: 8 },
  { rank: '10',   abbr: 'Sp', count: 1 },
  { rank: 'BOMB', abbr: 'B',  count: 6 },
  { rank: 'FLAG', abbr: 'F',  count: 1 },
];
```

Then, after the existing `renderBoard()` function (around line 219), add:

```javascript
function renderGraveyards(moveData) {
  const allPieces = [...piecesById.values()];

  const deadEnemyRanks = new Map();
  if (moveData) {
    for (const m of moveData) {
      if (m.move_type !== 'attack') continue;
      if (m.outcome === 'ATTACKER_WINS' || m.outcome === 'TIE') {
        const defenderOnSquare = allPieces.find(
          (p) => !p.alive && p.row_idx === m.to_row && p.col_idx === m.to_col && !p.is_mine
        );
        if (defenderOnSquare && !deadEnemyRanks.has(defenderOnSquare.piece_id)) {
          deadEnemyRanks.set(defenderOnSquare.piece_id, String(m.defender_rank));
        }
      }
      if (m.outcome === 'DEFENDER_WINS' || m.outcome === 'TIE') {
        const attackerDead = allPieces.find(
          (p) => !p.alive && !p.is_mine && p.piece_id === allPieces.find(
            (q) => !q.alive && q.row_idx === m.from_row && q.col_idx === m.from_col && !q.is_mine
          )?.piece_id
        );
        if (attackerDead && !deadEnemyRanks.has(attackerDead.piece_id)) {
          deadEnemyRanks.set(attackerDead.piece_id, String(m.attacker_rank));
        }
      }
    }
  }

  renderSingleGraveyard('graveyard-enemy-body', false, deadEnemyRanks);
  renderSingleGraveyard('graveyard-mine-body', true, null);
}

function renderSingleGraveyard(containerId, isMine, enemyRankMap) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const allPieces = [...piecesById.values()];
  const deadPieces = allPieces.filter((p) => !p.alive && p.is_mine === isMine);

  const deadByRank = new Map();
  for (const p of deadPieces) {
    let rank = p.rank != null ? String(p.rank) : null;
    if (!isMine && rank == null && enemyRankMap) {
      rank = enemyRankMap.get(p.piece_id) ?? null;
    }
    if (rank == null) continue;
    if (!deadByRank.has(rank)) deadByRank.set(rank, 0);
    deadByRank.set(rank, deadByRank.get(rank) + 1);
  }

  const colorSuffix = isMine ? 'mine' : 'enemy';

  const tray = document.createElement('div');
  tray.className = 'graveyard-tray';

  for (let i = 0; i < GRAVEYARD_RANKS.length; i++) {
    const entry = GRAVEYARD_RANKS[i];
    if (i > 0) {
      const divider = document.createElement('div');
      divider.className = 'graveyard-divider';
      tray.appendChild(divider);
    }

    const col = document.createElement('div');
    col.className = 'graveyard-column';

    const label = document.createElement('span');
    label.className = 'graveyard-rank-label';
    label.textContent = entry.abbr;
    col.appendChild(label);

    const deadCount = deadByRank.get(entry.rank) ?? 0;
    for (let s = 0; s < entry.count; s++) {
      const slot = document.createElement('div');
      slot.className = 'graveyard-slot';
      if (s < deadCount) {
        slot.classList.add(`filled-${colorSuffix}`);
        slot.textContent = entry.abbr;
      } else {
        slot.classList.add(`empty-${colorSuffix}`);
      }
      col.appendChild(slot);
    }

    tray.appendChild(col);
  }

  container.innerHTML = '';
  container.appendChild(tray);
}
```

- [ ] **Step 2: Store move data for graveyard use and call renderGraveyards from refreshMoveLog**

The moves data is already fetched in `refreshMoveLog`. Add a module-level variable to store it and call `renderGraveyards` after the move log renders.

After the existing `let botMoveScheduled = false;` line (line 41), add:

```javascript
let lastMoveData = null;
```

In `refreshMoveLog`, after the existing `if (error) return;` line, add:

```javascript
  lastMoveData = data;
```

At the end of `refreshMoveLog` (after the `for` loop that builds the `<li>` elements), add:

```javascript
  renderGraveyards(data);
```

Also update `refreshState()` to call `renderGraveyards` with the cached move data, so graveyards update even when only the board refreshes. After the existing `renderBoard();` line in `refreshState()`, add:

```javascript
  renderGraveyards(lastMoveData);
```

- [ ] **Step 3: Add the collapse toggle handler**

At the end of `web/js/game.js`, before the `init()` call, add:

```javascript
document.querySelectorAll('.graveyard-header').forEach((header) => {
  header.addEventListener('click', () => {
    header.closest('.graveyard').classList.toggle('collapsed');
  });
});
```

- [ ] **Step 4: Verify locally**

Start the local server (if not already running):

```bash
npx http-server web -p 8090 -s
```

Open `http://localhost:8090/game.html?code=TESTCODE` — it will show an error (no valid token), but you can verify:
1. The graveyard HTML containers render (inspect DOM).
2. The CSS loads without errors (check DevTools console).

For a real visual test, use Playwright against the production site by starting a bot game, playing a few moves with combat, and confirming the graveyards populate.

- [ ] **Step 5: Commit**

```bash
git add web/js/game.js
git commit -m "feat: render defeated pieces graveyards below the game board"
```

---

## Task 3: Push and deploy

**Files:** none (deploy + verification only)

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

Render auto-deploys on push to `main`. Wait ~1-2 minutes for the deploy.

- [ ] **Step 2: Live verify with Playwright**

Reuse the scratch Playwright install at `/tmp/pw-verify`. Write and run a script against `https://stratego-1ex2.onrender.com` that:

1. Opens the home page, clicks "Play vs Bot".
2. On setup, clicks "Defensive" to auto-fill, then clicks "Submit setup".
3. On the game page, confirms `.graveyards-area` exists with two `.graveyard` containers.
4. Confirms both graveyard headers say "Enemy Losses" and "Your Losses".
5. Confirms all graveyard slots start as empty (class `empty-mine` or `empty-enemy`) since no combat has happened yet.
6. Makes one attacking move (find an adjacent enemy piece and click it) — or just makes a few moves until combat naturally happens.
7. After combat, confirms at least one `.filled-mine` or `.filled-enemy` slot appears in the graveyards.
8. Clicks a graveyard header and confirms the `.collapsed` class toggles (body hides).

- [ ] **Step 3: Commit any fixes**

If the live verification reveals issues, fix them and push again. Repeat until the verification passes.

---

## Self-review notes

- **Spec coverage:** Layout (below board, enemy on top, yours below) ✓. Collapsible chevrons ✓. Horizontal rank columns with correct slot counts ✓. Filled/empty slot states with correct colors ✓. Data source (get_game_state + moves cross-reference) ✓. Mobile responsive ✓. Non-goals (no animation, no click interaction, no persistence) — correctly omitted.
- **No placeholders:** All code blocks complete, all commands specified.
- **Type/name consistency:** `GRAVEYARD_RANKS` defined once in Task 2 Step 1, used in `renderSingleGraveyard`. `renderGraveyards(moveData)` signature consistent between definition (Task 2 Step 1) and call sites (Task 2 Step 2). `lastMoveData` defined and used consistently. CSS class names match between Task 1 Step 3 and Task 2 Step 1 (`graveyard-tray`, `graveyard-column`, `graveyard-divider`, `graveyard-slot`, `filled-mine`, `filled-enemy`, `empty-mine`, `empty-enemy`, `graveyard-rank-label`).
