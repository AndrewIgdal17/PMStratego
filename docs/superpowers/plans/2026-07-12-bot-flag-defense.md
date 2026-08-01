# Bot Flag Defense + Personality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the bot positional awareness of threats to its own Flag (don't-vacate, reinforce-when-idle) and add a personality axis (aggressive/neutral/defensive) that resolves the probe-vs-reinforce tie-break.

**Architecture:** New pure module `web/js/flagDefense.js` with three functions (`findOwnFlag`, `assessGuardSquares`, `estimateUnknownEnemyRank`). Integration into `chooseBotMove` adds two move biases (don't-vacate, reinforce-when-idle) and a personality tie-break. Backend adds a `bot_personality` column, Edge Function, and UI button row mirroring the existing `bot_difficulty` pattern.

**Tech Stack:** Vanilla JS (browser ESM), Supabase Edge Functions (Deno/TypeScript), Supabase Postgres migrations, Node.js built-in `node:test` for testing.

---

### Task 1: `findOwnFlag` — test + implementation

**Files:**
- Create: `test/web/flagDefense.test.js`
- Create: `web/js/flagDefense.js`

- [ ] **Step 1: Write the failing test**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOwnFlag } from '../../web/js/flagDefense.js';

test('findOwnFlag returns the bot\'s alive Flag piece', () => {
  const pieces = [
    { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true },
    { id: 'scout-1', playerSlot: 2, rank: 9, row: 3, col: 0, alive: true },
    { id: 'flag-enemy', playerSlot: 1, rank: 'FLAG', row: 9, col: 5, alive: true },
  ];
  const flag = findOwnFlag(pieces, 2);
  assert.deepEqual(flag, { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true });
});

test('findOwnFlag returns null when the bot\'s Flag is dead', () => {
  const pieces = [
    { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: false },
  ];
  assert.equal(findOwnFlag(pieces, 2), null);
});

test('findOwnFlag returns null when no Flag exists for the given slot', () => {
  const pieces = [
    { id: 'scout-1', playerSlot: 2, rank: 9, row: 3, col: 0, alive: true },
  ];
  assert.equal(findOwnFlag(pieces, 2), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/web/flagDefense.test.js`
Expected: FAIL — `findOwnFlag` not found / module doesn't exist.

- [ ] **Step 3: Write minimal implementation**

Create `web/js/flagDefense.js`:

```javascript
// web/js/flagDefense.js
import { RANK } from "./rules/pieces.js";

export function findOwnFlag(pieces, botSlot) {
  return pieces.find(
    (p) => p.alive && p.playerSlot === botSlot && p.rank === RANK.FLAG,
  ) ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/web/flagDefense.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `node --test`
Expected: 84 existing tests + 3 new tests all PASS (87 total).

- [ ] **Step 6: Commit**

```bash
git add web/js/flagDefense.js test/web/flagDefense.test.js
git commit -m "feat(bot): add findOwnFlag to flagDefense module"
```

---

### Task 2: `estimateUnknownEnemyRank` — test + implementation

This function computes a weighted-average rank for unknown opponent pieces by walking the full move history to permanently track all revealed ranks, subtracting them from `ARMY_COMPOSITION` (excluding Bomb and Flag), and averaging the remainder.

**Files:**
- Modify: `test/web/flagDefense.test.js`
- Modify: `web/js/flagDefense.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/web/flagDefense.test.js`:

```javascript
import { estimateUnknownEnemyRank } from '../../web/js/flagDefense.js';
import { RANK } from '../../web/js/rules/pieces.js';

test('estimateUnknownEnemyRank returns the full-army weighted average when no ranks are revealed', () => {
  const result = estimateUnknownEnemyRank([], [], 2);
  // Mobile army (excluding Bomb/Flag): 1×1 + 1×2 + 2×3 + 3×4 + 4×5 + 4×6 + 4×7 + 5×8 + 8×9 + 1×10 = 213
  // Total mobile pieces: 1+1+2+3+4+4+4+5+8+1 = 33
  // Average: 213/33 ≈ 6.4545...
  assert.ok(Math.abs(result - 213 / 33) < 0.001);
});

test('estimateUnknownEnemyRank narrows the pool when an opponent rank is revealed via combat', () => {
  const pieces = [
    { id: 'enemy-marshal', playerSlot: 1, rank: null, row: 5, col: 5, alive: true },
  ];
  const history = [
    {
      move_number: 1,
      piece_id: 'enemy-marshal',
      player_slot: 1,
      attacker_rank: '1',
      defender_piece_id: 'our-scout',
      defender_rank: '9',
      outcome: 'ATTACKER_WINS',
    },
  ];
  const result = estimateUnknownEnemyRank(pieces, history, 2);
  // Marshal (rank 1, count 1) is now accounted for. Remaining pool: 32 pieces, sum = 212.
  assert.ok(Math.abs(result - 212 / 32) < 0.001);
});

test('estimateUnknownEnemyRank accounts for a dead-and-revealed piece', () => {
  const pieces = [
    { id: 'enemy-scout', playerSlot: 1, rank: null, row: 5, col: 5, alive: false },
  ];
  const history = [
    {
      move_number: 1,
      piece_id: 'bot-colonel',
      player_slot: 2,
      attacker_rank: '3',
      defender_piece_id: 'enemy-scout',
      defender_rank: '9',
      outcome: 'ATTACKER_WINS',
    },
  ];
  const result = estimateUnknownEnemyRank(pieces, history, 2);
  // One Scout (rank 9) accounted for. Remaining: 32 pieces, sum = 213-9 = 204.
  assert.ok(Math.abs(result - 204 / 32) < 0.001);
});

test('estimateUnknownEnemyRank falls back to the single remaining rank when pool has one rank left', () => {
  // Simulate all mobile ranks fully revealed except Scouts (8 of them).
  // Build history that reveals exactly all non-Scout mobile pieces.
  const history = [];
  let moveNum = 1;
  const revealCounts = [
    [1, 1], [2, 1], [3, 2], [4, 3], [5, 4], [6, 4], [7, 4], [8, 5], [10, 1],
  ];
  for (const [rank, count] of revealCounts) {
    for (let i = 0; i < count; i++) {
      history.push({
        move_number: moveNum++,
        piece_id: `enemy-${rank}-${i}`,
        player_slot: 1,
        attacker_rank: String(rank),
        defender_piece_id: null,
        defender_rank: null,
        outcome: 'ATTACKER_WINS',
      });
    }
  }
  const result = estimateUnknownEnemyRank([], history, 2);
  // Only Scouts (rank 9) remain. Average of [9,9,9,9,9,9,9,9] = 9.
  assert.equal(result, 9);
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `node --test test/web/flagDefense.test.js`
Expected: FAIL — `estimateUnknownEnemyRank` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `web/js/flagDefense.js`:

```javascript
import { ARMY_COMPOSITION } from "./rules/pieces.js";

export function estimateUnknownEnemyRank(pieces, fullMoveHistory, botSlot) {
  const revealedCounts = new Map();

  for (const move of fullMoveHistory) {
    if (!move.outcome) continue;

    if (move.player_slot !== botSlot && move.attacker_rank != null) {
      const rank = normalizeRank(move.attacker_rank);
      if (rank !== RANK.BOMB && rank !== RANK.FLAG) {
        revealedCounts.set(rank, (revealedCounts.get(rank) ?? 0) + 1);
      }
    }
    if (move.defender_piece_id != null && move.defender_rank != null) {
      const defenderIsEnemy = move.player_slot === botSlot;
      if (defenderIsEnemy) {
        const rank = normalizeRank(move.defender_rank);
        if (rank !== RANK.BOMB && rank !== RANK.FLAG) {
          revealedCounts.set(rank, (revealedCounts.get(rank) ?? 0) + 1);
        }
      }
    }
  }

  let totalCount = 0;
  let weightedSum = 0;

  for (const entry of ARMY_COMPOSITION) {
    const rank = entry.rank;
    if (rank === RANK.BOMB || rank === RANK.FLAG) continue;
    const remaining = Math.max(0, entry.count - (revealedCounts.get(rank) ?? 0));
    totalCount += remaining;
    weightedSum += remaining * rank;
  }

  if (totalCount === 0) {
    const lastRank = [...revealedCounts.keys()].pop();
    return lastRank ?? RANK.CAPTAIN;
  }

  return weightedSum / totalCount;
}

function normalizeRank(rank) {
  if (rank === "BOMB" || rank === "FLAG" || rank == null) return rank;
  return Number(rank);
}
```

Note: the `normalizeRank` helper and the `ARMY_COMPOSITION` import are added here. Ensure the import block at the top of `flagDefense.js` now reads:

```javascript
import { RANK, ARMY_COMPOSITION } from "./rules/pieces.js";
```

- [ ] **Step 4: Run test to verify they pass**

Run: `node --test test/web/flagDefense.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `node --test`
Expected: 91 total tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/js/flagDefense.js test/web/flagDefense.test.js
git commit -m "feat(bot): add estimateUnknownEnemyRank to flagDefense module"
```

---

### Task 3: `assessGuardSquares` — test + implementation

This is the core guard-square classifier. For each orthogonal neighbor of the Flag, it returns `safe`, `atRisk`, or `open` — skipping off-board, lake, and enemy-occupied (breached) squares.

**Files:**
- Modify: `test/web/flagDefense.test.js`
- Modify: `web/js/flagDefense.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/web/flagDefense.test.js`:

```javascript
import { assessGuardSquares } from '../../web/js/flagDefense.js';

test('assessGuardSquares marks an empty neighbor as open', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true };
  const pieces = [flag];
  const memory = new Map();
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  const openSquare = result.find((s) => s.row === 1 && s.col === 5);
  assert.equal(openSquare.status, 'open');
});

test('assessGuardSquares marks a guarded square as safe when no enemies are nearby', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true };
  const guard = { id: 'colonel-1', playerSlot: 2, rank: 3, row: 1, col: 5, alive: true };
  const pieces = [flag, guard];
  const memory = new Map();
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  const guardedSquare = result.find((s) => s.row === 1 && s.col === 5);
  assert.equal(guardedSquare.status, 'safe');
  assert.equal(guardedSquare.occupiedByPieceId, 'colonel-1');
});

test('assessGuardSquares marks a guarded square as atRisk when a stronger enemy is within radius', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true };
  const guard = { id: 'sergeant-1', playerSlot: 2, rank: 7, row: 1, col: 5, alive: true };
  const enemy = { id: 'marshal-e', playerSlot: 1, rank: 1, row: 2, col: 5, alive: true };
  const pieces = [flag, guard, enemy];
  const memory = new Map([['marshal-e', 1]]);
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  const guardedSquare = result.find((s) => s.row === 1 && s.col === 5);
  assert.equal(guardedSquare.status, 'atRisk');
});

test('assessGuardSquares uses unknownRankEstimate for unrevealed enemies within radius', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true };
  const guard = { id: 'captain-1', playerSlot: 2, rank: 5, row: 1, col: 5, alive: true };
  // Unknown enemy within radius — estimated rank 3 (beats Captain 5)
  const enemy = { id: 'unknown-e', playerSlot: 1, rank: null, row: 2, col: 4, alive: true };
  const pieces = [flag, guard, enemy];
  const memory = new Map();
  const result = assessGuardSquares(pieces, flag, 2, memory, 3, 2);
  const guardedSquare = result.find((s) => s.row === 1 && s.col === 5);
  assert.equal(guardedSquare.status, 'atRisk');
});

test('assessGuardSquares skips off-board neighbors (Flag in corner)', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 0, alive: true };
  const pieces = [flag];
  const memory = new Map();
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  // (0,0) has only 2 on-board neighbors: (1,0) and (0,1). (-1,0) and (0,-1) are off-board.
  assert.equal(result.length, 2);
});

test('assessGuardSquares skips lake neighbors', () => {
  // Flag at (3,2): neighbor (4,2) is a lake square per LAKE_SQUARES
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 3, col: 2, alive: true };
  const pieces = [flag];
  const memory = new Map();
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  const lakeNeighbor = result.find((s) => s.row === 4 && s.col === 2);
  assert.equal(lakeNeighbor, undefined);
});

test('assessGuardSquares omits squares occupied by an enemy piece (breached)', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true };
  const enemy = { id: 'enemy-1', playerSlot: 1, rank: null, row: 1, col: 5, alive: true };
  const pieces = [flag, enemy];
  const memory = new Map();
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  const breachedSquare = result.find((s) => s.row === 1 && s.col === 5);
  assert.equal(breachedSquare, undefined);
});

test('assessGuardSquares: guard safe when enemy is outside lookoutRadius', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true };
  const guard = { id: 'sergeant-1', playerSlot: 2, rank: 7, row: 1, col: 5, alive: true };
  // Enemy at Chebyshev distance 3 from the guard — radius 2 should not see it
  const enemy = { id: 'marshal-e', playerSlot: 1, rank: 1, row: 4, col: 5, alive: true };
  const pieces = [flag, guard, enemy];
  const memory = new Map([['marshal-e', 1]]);
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  const guardedSquare = result.find((s) => s.row === 1 && s.col === 5);
  assert.equal(guardedSquare.status, 'safe');
});

test('assessGuardSquares: atRisk when enemy would TIE (tie removes the guard)', () => {
  const flag = { id: 'flag-1', playerSlot: 2, rank: 'FLAG', row: 0, col: 5, alive: true };
  const guard = { id: 'captain-1', playerSlot: 2, rank: 5, row: 1, col: 5, alive: true };
  const enemy = { id: 'captain-e', playerSlot: 1, rank: 5, row: 2, col: 5, alive: true };
  const pieces = [flag, guard, enemy];
  const memory = new Map([['captain-e', 5]]);
  const result = assessGuardSquares(pieces, flag, 2, memory, 5, 2);
  const guardedSquare = result.find((s) => s.row === 1 && s.col === 5);
  assert.equal(guardedSquare.status, 'atRisk');
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `node --test test/web/flagDefense.test.js`
Expected: FAIL — `assessGuardSquares` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `web/js/flagDefense.js`:

```javascript
import { isOnBoard, isLake } from "./rules/board.js";
import { resolveCombat, COMBAT_OUTCOME } from "./rules/combat.js";

const ORTHOGONAL = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function assessGuardSquares(pieces, flag, botSlot, memory, unknownRankEstimate, lookoutRadius) {
  const results = [];

  for (const [dr, dc] of ORTHOGONAL) {
    const row = flag.row + dr;
    const col = flag.col + dc;

    if (!isOnBoard(row, col) || isLake(row, col)) continue;

    const occupant = pieces.find((p) => p.alive && p.row === row && p.col === col);

    if (occupant && occupant.playerSlot !== botSlot) continue;

    if (!occupant) {
      results.push({ row, col, status: 'open', occupiedByPieceId: null });
      continue;
    }

    const guardRank = occupant.rank;
    const nearbyEnemies = pieces.filter(
      (p) => p.alive && p.playerSlot !== botSlot &&
        Math.max(Math.abs(p.row - row), Math.abs(p.col - col)) <= lookoutRadius,
    );

    let atRisk = false;
    for (const enemy of nearbyEnemies) {
      const enemyRank = memory.get(enemy.id) ?? (enemy.rank != null ? enemy.rank : unknownRankEstimate);
      const estimatedRankInt = typeof enemyRank === 'number' ? enemyRank : Math.round(enemyRank);
      const outcome = resolveCombat(estimatedRankInt, guardRank);
      if (outcome === COMBAT_OUTCOME.ATTACKER_WINS || outcome === COMBAT_OUTCOME.TIE) {
        atRisk = true;
        break;
      }
    }

    results.push({
      row,
      col,
      status: atRisk ? 'atRisk' : 'safe',
      occupiedByPieceId: occupant.id,
    });
  }

  return results;
}
```

Note: the `unknownRankEstimate` may be a non-integer (weighted average). `resolveCombat` compares numeric ranks with `<`, so a fractional rank like `6.45` works correctly for the comparison against integer guard ranks — no rounding needed. Remove the `Math.round` call:

```javascript
const estimatedRankInt = typeof enemyRank === 'number' ? enemyRank : enemyRank;
```

Actually, simplify to just:

```javascript
const effectiveRank = memory.get(enemy.id) ?? (enemy.rank != null ? enemy.rank : unknownRankEstimate);
const outcome = resolveCombat(effectiveRank, guardRank);
```

The `resolveCombat` function handles numeric comparisons directly (lower rank wins). A fractional estimate like `6.45` correctly loses to rank `5` and wins against rank `7`.

- [ ] **Step 4: Run test to verify they pass**

Run: `node --test test/web/flagDefense.test.js`
Expected: 16 tests PASS.

- [ ] **Step 5: Run full suite**

Run: `node --test`
Expected: 100 total tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/js/flagDefense.js test/web/flagDefense.test.js
git commit -m "feat(bot): add assessGuardSquares to flagDefense module"
```

---

### Task 4: Integrate flag defense into `chooseBotMove` — don't-vacate filter

The don't-vacate filter removes moves whose `from` square is an `atRisk` guard square, when a non-vacating alternative exists in the same pool.

**Files:**
- Modify: `web/js/bot.js`
- Modify: `test/web/bot.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/web/bot.test.js`:

```javascript
test('chooseBotMove does not vacate an atRisk guard square when a non-vacating alternative exists', () => {
  // Bot Flag at (0,5). Guard sergeant at (1,5) — atRisk because enemy Marshal
  // at (2,5) is within radius. Bot also has a Scout at (0,0) with a free move.
  // The sergeant should NOT be moved away from its guard position.
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'sergeant-1', player_slot: 2, rank: '7', row_idx: 1, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'marshal-e', player_slot: 1, rank: '1', row_idx: 2, col_idx: 5, alive: true, is_mine: false },
  ];
  const history = [
    { move_number: 1, piece_id: 'marshal-e', player_slot: 1, attacker_rank: '1',
      defender_piece_id: null, defender_rank: null, outcome: 'ATTACKER_WINS' },
  ];
  const move = chooseBotMove(rows, 2, history, 'hard', 4);
  assert.notEqual(move.pieceId, 'sergeant-1',
    'should not vacate the guard square when a non-vacating alternative exists');
});

test('chooseBotMove vacates an atRisk guard square when it is the only movable piece', () => {
  // Bot Flag at (0,5). Guard sergeant at (1,5) — atRisk, but it's the only
  // movable piece. It must move (Bombs/Flag can't).
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'sergeant-1', player_slot: 2, rank: '7', row_idx: 1, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'marshal-e', player_slot: 1, rank: '1', row_idx: 2, col_idx: 5, alive: true, is_mine: false },
  ];
  const history = [
    { move_number: 1, piece_id: 'marshal-e', player_slot: 1, attacker_rank: '1',
      defender_piece_id: null, defender_rank: null, outcome: 'ATTACKER_WINS' },
  ];
  const move = chooseBotMove(rows, 2, history, 'hard', 4);
  assert.equal(move.pieceId, 'sergeant-1',
    'must vacate when it is the only movable piece');
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `node --test test/web/bot.test.js`
Expected: FAIL — the don't-vacate filter doesn't exist yet, so the bot may pick the sergeant.

- [ ] **Step 3: Integrate flag defense into `chooseBotMove`**

Modify `web/js/bot.js`. Add import at the top:

```javascript
import { findOwnFlag, assessGuardSquares, estimateUnknownEnemyRank } from "./flagDefense.js";
```

Add a `LOOKOUT_RADIUS` constant:

```javascript
const LOOKOUT_RADIUS = { easy: 1, medium: 2, hard: 3 };
```

Inside `chooseBotMove`, after the `suspects` computation (line 72) and before the pool classification loop (line 74), add the guard-square assessment:

```javascript
  const flag = findOwnFlag(pieces, botSlot);
  let guardStatuses = [];
  if (flag) {
    const unknownRankEstimate = estimateUnknownEnemyRank(pieces, fullMoveHistory, botSlot);
    guardStatuses = assessGuardSquares(pieces, flag, botSlot, memory, unknownRankEstimate, LOOKOUT_RADIUS[difficulty] ?? 2);
  }
  const atRiskFromSquares = new Set(
    guardStatuses.filter((s) => s.status === 'atRisk').map((s) => `${s.row},${s.col}`),
  );
```

After the existing valuable-piece filter (around line 112, after the `if (valuableOnSuspect)` block), add the don't-vacate filter:

```javascript
  if (atRiskFromSquares.size > 0) {
    const nonVacating = pool.filter(
      (move) => !atRiskFromSquares.has(`${move.from.row},${move.from.col}`),
    );
    if (nonVacating.length > 0) {
      pool = nonVacating;
    }
  }
```

- [ ] **Step 4: Run test to verify they pass**

Run: `node --test test/web/bot.test.js`
Expected: All existing + 2 new tests PASS.

- [ ] **Step 5: Run full suite**

Run: `node --test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/js/bot.js test/web/bot.test.js
git commit -m "feat(bot): add don't-vacate guard square filter to chooseBotMove"
```

---

### Task 5: Reinforce-when-idle bias in `chooseBotMove`

When no winning move exists and there's an `open` guard square, prefer moving a non-valuable piece to fill it.

**Files:**
- Modify: `web/js/bot.js`
- Modify: `test/web/bot.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/web/bot.test.js`:

```javascript
test('chooseBotMove reinforces an open guard square when idle (no winning moves)', () => {
  // Bot Flag at (0,5). Square (1,5) is open. Scout at (1,4) can move to (1,5).
  // No enemy pieces in combat range, so no winning moves. Bot should fill the gap.
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 1, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 6, alive: true, is_mine: true },
  ];
  // rng() > any threshold to avoid probe logic interfering
  const move = chooseBotMove(rows, 2, [], 'hard', 0, () => 0.99);
  assert.deepEqual(move.to, { row: 1, col: 5 },
    'should move to the open guard square');
});

test('chooseBotMove prefers a non-valuable piece for reinforcement', () => {
  // Bot Flag at (0,5). Square (1,5) is open. Both a Marshal (valuable) at
  // (1,4) and a Scout (non-valuable) at (2,5) can reach (1,5).
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'marshal-1', player_slot: 2, rank: '1', row_idx: 1, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 2, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 6, alive: true, is_mine: true },
  ];
  const move = chooseBotMove(rows, 2, [], 'hard', 0, () => 0.99);
  assert.equal(move.pieceId, 'scout-1',
    'should prefer the non-valuable piece for reinforcement');
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `node --test test/web/bot.test.js`
Expected: FAIL — reinforcement logic doesn't exist yet.

- [ ] **Step 3: Implement reinforce-when-idle bias**

In `web/js/bot.js`, inside `chooseBotMove`, after the don't-vacate filter and before the probe-when-idle block, compute the `openGuardSquares` set and reinforcement candidates:

```javascript
  const openGuardSquares = new Set(
    guardStatuses.filter((s) => s.status === 'open').map((s) => `${s.row},${s.col}`),
  );
```

Modify the probe-when-idle section. The existing code (lines 117-124) looks like:

```javascript
  if (winning.length === 0 && suspects.size > 0 && rng() < PROBE_PROBABILITY[difficulty]) {
    const probeMoves = safe.filter(
      (move) => PROBE_ELIGIBLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
    );
    if (probeMoves.length > 0) {
      return probeMoves[Math.floor(rng() * probeMoves.length)];
    }
  }
```

Replace it with logic that computes both probe and reinforce candidates, then applies the personality tie-break (personality defaults to `'neutral'` for now; the `personality` parameter will be added in Task 7):

```javascript
  if (winning.length === 0) {
    let reinforceMoves = [];
    if (openGuardSquares.size > 0) {
      reinforceMoves = pool.filter(
        (move) => openGuardSquares.has(`${move.to.row},${move.to.col}`),
      );
      const nonValuableReinforce = reinforceMoves.filter(
        (move) => !VALUABLE_RANKS.has(movingPieceRank(move)),
      );
      if (nonValuableReinforce.length > 0) reinforceMoves = nonValuableReinforce;
    }

    let probeMoves = [];
    if (suspects.size > 0 && rng() < PROBE_PROBABILITY[difficulty]) {
      probeMoves = safe.filter(
        (move) => PROBE_ELIGIBLE_RANKS.has(movingPieceRank(move)) && isSuspectedSquare(suspects, pieces, move.to.row, move.to.col),
      );
    }

    if (reinforceMoves.length > 0 && probeMoves.length === 0) {
      return reinforceMoves[Math.floor(rng() * reinforceMoves.length)];
    }
    if (probeMoves.length > 0 && reinforceMoves.length === 0) {
      return probeMoves[Math.floor(rng() * probeMoves.length)];
    }
    if (reinforceMoves.length > 0 && probeMoves.length > 0) {
      // Personality tie-break will be added in Task 7; default to neutral (coin flip)
      const first = rng() < 0.5 ? reinforceMoves : probeMoves;
      const second = first === reinforceMoves ? probeMoves : reinforceMoves;
      if (first.length > 0) return first[Math.floor(rng() * first.length)];
      return second[Math.floor(rng() * second.length)];
    }
  }
```

- [ ] **Step 4: Run test to verify they pass**

Run: `node --test test/web/bot.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Run full suite**

Run: `node --test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/js/bot.js test/web/bot.test.js
git commit -m "feat(bot): add reinforce-when-idle bias for open guard squares"
```

---

### Task 6: Personality tie-break in `chooseBotMove`

Add the `personality` parameter and implement the three tie-break behaviors when both probe and reinforce candidates exist on the same turn.

**Files:**
- Modify: `web/js/bot.js`
- Modify: `test/web/bot.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/web/bot.test.js`:

```javascript
test('chooseBotMove personality=aggressive: probes before reinforcing when both are available', () => {
  // Bot Flag at (0,5). Guard (1,5) is open (reinforce candidate).
  // Suspect at (3,0) is probe-eligible (scout at (2,0) can reach it).
  // With aggressive personality, probe should win the tie-break.
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 1, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'scout-2', player_slot: 2, rank: '9', row_idx: 2, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 6, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 3, col_idx: 0, alive: true, is_mine: false },
  ];
  // rng always returns 0 (forces probe roll to succeed; for random pick, picks first)
  const move = chooseBotMove(rows, 2, [], 'hard', 20, () => 0, 'aggressive');
  assert.deepEqual(move.to, { row: 3, col: 0 }, 'aggressive should probe');
});

test('chooseBotMove personality=defensive: reinforces before probing when both are available', () => {
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 1, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'scout-2', player_slot: 2, rank: '9', row_idx: 2, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 6, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 3, col_idx: 0, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, [], 'hard', 20, () => 0, 'defensive');
  assert.deepEqual(move.to, { row: 1, col: 5 }, 'defensive should reinforce');
});

test('chooseBotMove personality=neutral: coin flip decides probe vs reinforce (rng < 0.5 → reinforce)', () => {
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 1, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'scout-2', player_slot: 2, rank: '9', row_idx: 2, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 6, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 3, col_idx: 0, alive: true, is_mine: false },
  ];
  // rng sequence: first call (probe roll) returns 0 (probe succeeds), second call (tie-break coin) returns 0.3 (< 0.5 → reinforce wins)
  let callCount = 0;
  const rng = () => { callCount++; return callCount === 1 ? 0 : 0.3; };
  const move = chooseBotMove(rows, 2, [], 'hard', 20, rng, 'neutral');
  assert.deepEqual(move.to, { row: 1, col: 5 }, 'neutral with rng < 0.5 should reinforce');
});

test('chooseBotMove personality=neutral: coin flip decides probe vs reinforce (rng >= 0.5 → probe)', () => {
  const rows = [
    { piece_id: 'flag-1', player_slot: 2, rank: 'FLAG', row_idx: 0, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 1, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'scout-2', player_slot: 2, rank: '9', row_idx: 2, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 6, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 3, col_idx: 0, alive: true, is_mine: false },
  ];
  // rng sequence: first call returns 0 (probe roll succeeds), second call returns 0.7 (>= 0.5 → probe wins)
  let callCount = 0;
  const rng = () => { callCount++; return callCount === 1 ? 0 : 0.7; };
  const move = chooseBotMove(rows, 2, [], 'hard', 20, rng, 'neutral');
  assert.deepEqual(move.to, { row: 3, col: 0 }, 'neutral with rng >= 0.5 should probe');
});
```

- [ ] **Step 2: Run test to verify they fail**

Run: `node --test test/web/bot.test.js`
Expected: FAIL — `chooseBotMove` doesn't accept or use a `personality` parameter yet.

- [ ] **Step 3: Add personality parameter and tie-break logic**

In `web/js/bot.js`, update the `chooseBotMove` signature:

```javascript
export function chooseBotMove(gameStateRows, botSlot, fullMoveHistory, difficulty = "medium", currentTurn = fullMoveHistory.length, rng = Math.random, personality = "neutral") {
```

Update the tie-break block (the `if (reinforceMoves.length > 0 && probeMoves.length > 0)` branch from Task 5):

```javascript
    if (reinforceMoves.length > 0 && probeMoves.length > 0) {
      let first, second;
      if (personality === 'aggressive') {
        first = probeMoves;
        second = reinforceMoves;
      } else if (personality === 'defensive') {
        first = reinforceMoves;
        second = probeMoves;
      } else {
        first = rng() < 0.5 ? reinforceMoves : probeMoves;
        second = first === reinforceMoves ? probeMoves : reinforceMoves;
      }
      if (first.length > 0) return first[Math.floor(rng() * first.length)];
      return second[Math.floor(rng() * second.length)];
    }
```

- [ ] **Step 4: Run test to verify they pass**

Run: `node --test test/web/bot.test.js`
Expected: All tests PASS.

- [ ] **Step 5: Run full suite**

Run: `node --test`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add web/js/bot.js test/web/bot.test.js
git commit -m "feat(bot): add personality parameter and probe-vs-reinforce tie-break"
```

---

### Task 7: Database migration + Edge Function for `bot_personality`

Mirror the existing `bot_difficulty` pattern exactly.

**Files:**
- Create: `supabase/migrations/0008_bot_personality.sql`
- Create: `supabase/functions/set-bot-personality/index.ts`

- [ ] **Step 1: Create the migration**

Create `supabase/migrations/0008_bot_personality.sql`:

```sql
alter table games add column bot_personality text check (bot_personality in ('aggressive', 'neutral', 'defensive'));
```

- [ ] **Step 2: Create the Edge Function**

Create `supabase/functions/set-bot-personality/index.ts`:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALID_PERSONALITIES = ["aggressive", "neutral", "defensive"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const { token, personality } = await req.json();
  if (!token || !personality) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400, headers: corsHeaders });
  }

  if (!VALID_PERSONALITIES.includes(personality)) {
    return new Response(JSON.stringify({ error: "INVALID_PERSONALITY" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401, headers: corsHeaders });
  }

  if (playerRow.player_slot !== 1) {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 403, headers: corsHeaders });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, is_bot_game")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || !game.is_bot_game || game.status !== "setup") {
    return new Response(JSON.stringify({ error: "NOT_ALLOWED" }), { status: 409, headers: corsHeaders });
  }

  const { error: updateError } = await supabase
    .from("games")
    .update({ bot_personality: personality, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  if (updateError) {
    return new Response(JSON.stringify({ error: "UPDATE_FAILED", detail: updateError.message }), {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, personality }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_bot_personality.sql supabase/functions/set-bot-personality/index.ts
git commit -m "feat(backend): add bot_personality column and set-bot-personality Edge Function"
```

---

### Task 8: Wire `bot_personality` through `game.js` into `chooseBotMove`

**Files:**
- Modify: `web/js/game.js`

- [ ] **Step 1: Add `bot_personality` to `refreshGameRow` select**

In `web/js/game.js`, line 146, change:

```javascript
    .select("status, current_turn_slot, turn_number, winner_slot, is_bot_game, bot_difficulty")
```

to:

```javascript
    .select("status, current_turn_slot, turn_number, winner_slot, is_bot_game, bot_difficulty, bot_personality")
```

- [ ] **Step 2: Pass personality into `chooseBotMove`**

In `web/js/game.js`, in the `makeBotMove` function, line 284, change:

```javascript
    const difficulty = gameRow?.bot_difficulty ?? "medium";
    const move = chooseBotMove(rows, BOT_SLOT, fullMoveHistory, difficulty, fullMoveHistory.length);
```

to:

```javascript
    const difficulty = gameRow?.bot_difficulty ?? "medium";
    const personality = gameRow?.bot_personality ?? "neutral";
    const move = chooseBotMove(rows, BOT_SLOT, fullMoveHistory, difficulty, fullMoveHistory.length, Math.random, personality);
```

- [ ] **Step 3: Run full suite to confirm no regressions**

Run: `node --test`
Expected: All tests PASS (game.js changes are UI wiring only, not tested by unit tests, but must not break imports).

- [ ] **Step 4: Commit**

```bash
git add web/js/game.js
git commit -m "feat(game): wire bot_personality from DB into chooseBotMove"
```

---

### Task 9: Setup screen UI for personality selection

Add a second button row to the setup screen, mirroring the difficulty controls.

**Files:**
- Modify: `web/setup.html`
- Modify: `web/js/setup.js`

- [ ] **Step 1: Add personality button markup to `setup.html`**

In `web/setup.html`, after the `difficulty-controls` div (line 42), add:

```html
          <div id="personality-controls" class="setup-controls" hidden>
            <span class="difficulty-label">Bot personality:</span>
            <button class="difficulty-btn" data-personality="aggressive">Aggressive</button>
            <button class="difficulty-btn" data-personality="neutral">Neutral</button>
            <button class="difficulty-btn" data-personality="defensive">Defensive</button>
          </div>
```

Note: reuses `difficulty-btn` / `difficulty-label` CSS classes as specified in the design spec — same visual treatment, different `data-personality` attribute.

- [ ] **Step 2: Add `initPersonalityControls` to `setup.js`**

In `web/js/setup.js`, after the `initDifficultyControls` function and its call (around line 114), add:

```javascript
async function initPersonalityControls() {
  const { data: gameRow } = await supabase.from("games").select("is_bot_game, bot_personality").eq("room_code", roomCode).single();
  if (!gameRow || !gameRow.is_bot_game || slot !== 1) return;

  const container = document.getElementById("personality-controls");
  container.hidden = false;

  function highlightSelected(personality) {
    container.querySelectorAll(".difficulty-btn").forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.personality === personality);
    });
  }

  highlightSelected(gameRow.bot_personality ?? "neutral");

  container.querySelectorAll(".difficulty-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await callFunction("set-bot-personality", { token, personality: btn.dataset.personality });
        highlightSelected(btn.dataset.personality);
      } catch (err) {
        const statusEl = document.getElementById("setup-status");
        statusEl.hidden = false;
        statusEl.textContent = `Failed to set personality: ${err.message}`;
      }
    });
  });
}

initPersonalityControls();
```

- [ ] **Step 3: Test manually (no automated test for UI)**

Open the setup page for a bot game. Verify:
1. The personality button row appears below the difficulty row.
2. "Neutral" is selected by default.
3. Clicking "Aggressive" / "Defensive" updates the selection and persists across page reloads.
4. Non-bot games and slot-2 players don't see the row.

- [ ] **Step 4: Commit**

```bash
git add web/setup.html web/js/setup.js
git commit -m "feat(ui): add bot personality selector to setup screen"
```

---

### Task 10: Final integration test — full suite green

Run the complete test suite and verify everything passes together.

**Files:** None (verification only).

- [ ] **Step 1: Run full test suite**

Run: `node --test`
Expected: All tests PASS. Count should be 84 (original) + new tests from Tasks 1–6.

- [ ] **Step 2: Verify no lint / import errors by running the test runner**

Run: `node --test 2>&1`
Expected: No module-not-found errors, no syntax errors.

- [ ] **Step 3: Spot-check `chooseBotMove` still handles the original test scenarios unchanged**

Run: `node --test test/web/bot.test.js`
Expected: All 11 original bot tests + all new tests PASS.

- [ ] **Step 4: Commit (if any fixups needed)**

```bash
git add -A
git commit -m "chore: final integration verification for flag defense + personality feature"
```

---

## File Change Summary

| Action | File | Purpose |
|---|---|---|
| Create | `web/js/flagDefense.js` | `findOwnFlag`, `assessGuardSquares`, `estimateUnknownEnemyRank` |
| Create | `test/web/flagDefense.test.js` | Tests for all three flagDefense functions |
| Create | `supabase/migrations/0008_bot_personality.sql` | Add `bot_personality` column |
| Create | `supabase/functions/set-bot-personality/index.ts` | Edge Function for setting personality |
| Modify | `web/js/bot.js` | Integrate flag defense + personality into `chooseBotMove` |
| Modify | `test/web/bot.test.js` | Tests for don't-vacate, reinforce, personality tie-break |
| Modify | `web/js/game.js` | Select + pass `bot_personality` to `chooseBotMove` |
| Modify | `web/setup.html` | Personality button markup |
| Modify | `web/js/setup.js` | Personality control init + click handlers |

## Dead code removal

None — purely additive to existing bot difficulty logic, which is unchanged.
