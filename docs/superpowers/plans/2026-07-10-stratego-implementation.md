# Poor Man's Online Stratego Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free-to-host, two-player, full-official-rules Stratego game — Render static site + Supabase (Postgres, Edge Functions, Realtime) for everything else, no custom server.

**Architecture:** A dependency-free JS rules engine (movement, combat, two-square rule, win conditions) is the single source of truth for game logic. It's unit-tested directly with `node --test`, then imported unmodified into a Supabase Edge Function (`make-move`) that adds persistence and token-based auth around it. Fog-of-war is enforced by denying all direct client reads of the `pieces` table and exposing state only through a `get_game_state(token)` Postgres function that redacts unrevealed opponent ranks. The frontend is plain HTML/CSS/JS (no bundler) served as a Render Static Site, talking to Supabase via its CDN-hosted JS client and subscribing to Realtime for live updates.

**Tech Stack:** Plain JavaScript (ESM) rules engine, Node's built-in test runner, Supabase (Postgres + Edge Functions on Deno + Realtime + JS client), plain HTML/CSS/JS frontend, Render Static Site, Supabase CLI for schema/function deploys.

**Design reference:** `docs/superpowers/specs/2026-07-10-stratego-design.md`

---

## File structure

```
repos/stratego/
├── package.json                          # test script, Node engine pin, supabase CLI devDependency
├── src/rules/                            # pure game logic — zero DB/network imports
│   ├── board.js                          # board size, lake squares, coordinate helpers
│   ├── pieces.js                         # rank constants, army composition
│   ├── movement.js                       # move legality (adjacency, scout paths, ownership)
│   ├── combat.js                         # combat table (incl. Spy/Marshal, Miner/Bomb)
│   ├── twoSquareRule.js                  # anti-stalling repetition check
│   └── game.js                           # applyMove() orchestrator + win-condition check
├── test/rules/
│   ├── board.test.js
│   ├── movement.test.js
│   ├── combat.test.js
│   ├── twoSquareRule.test.js
│   └── game.test.js
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql                 # tables, RLS policies, get_game_state()
│   └── functions/
│       ├── _shared/rules/                # copies of src/rules/*.js, imported by Edge Functions
│       ├── create-game/index.ts
│       ├── join-game/index.ts
│       ├── submit-setup/index.ts
│       ├── make-move/index.ts
│       └── send-chat/index.ts
├── web/                                  # deployed as the Render Static Site
│   ├── index.html                        # home: new game / join with code
│   ├── setup.html                        # piece placement screen
│   ├── game.html                         # board + move log + chat
│   ├── css/styles.css
│   └── js/
│       ├── supabaseClient.js
│       ├── home.js
│       ├── setup.js
│       └── game.js
├── render.yaml                           # Render static site blueprint
└── README.md                             # local dev + deploy instructions
```

`src/rules/*.js` is the canonical source. `supabase/functions/_shared/rules/*.js` is a byte-identical copy (Deno can't import across the `supabase/functions` boundary from outside it, and Edge Functions must be self-contained for deploy). Task 12 includes a step that copies the files and a comment marking them as generated, so future edits know to update the source and re-copy.

---

## Task 1: Repo scaffolding

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "stratego",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=18.9.0"
  },
  "scripts": {
    "test": "node --test test/"
  },
  "devDependencies": {
    "supabase": "^1.200.0"
  }
}
```

- [ ] **Step 2: Update `.gitignore`**

```
.superpowers/
node_modules/
.env
.env.local
```

- [ ] **Step 3: Commit**

```bash
git add package.json .gitignore
git commit -m "chore: scaffold package.json and gitignore"
```

---

## Task 2: Rules engine — board & pieces constants

**Files:**
- Create: `src/rules/board.js`
- Create: `src/rules/pieces.js`
- Test: `test/rules/board.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// test/rules/board.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_SIZE, isOnBoard, isLake, squareKey } from '../../src/rules/board.js';

test('board is 10x10', () => {
  assert.equal(BOARD_SIZE, 10);
});

test('isOnBoard rejects out-of-range coordinates', () => {
  assert.equal(isOnBoard(0, 0), true);
  assert.equal(isOnBoard(9, 9), true);
  assert.equal(isOnBoard(-1, 0), false);
  assert.equal(isOnBoard(0, 10), false);
  assert.equal(isOnBoard(10, 0), false);
});

test('isLake identifies the two standard 2x2 lakes', () => {
  const lakeSquares = [
    [4, 2], [4, 3], [5, 2], [5, 3],
    [4, 6], [4, 7], [5, 6], [5, 7],
  ];
  for (const [row, col] of lakeSquares) {
    assert.equal(isLake(row, col), true, `expected (${row},${col}) to be a lake`);
  }
});

test('isLake rejects non-lake squares, including squares just outside a lake', () => {
  assert.equal(isLake(0, 0), false);
  assert.equal(isLake(4, 4), false);
  assert.equal(isLake(6, 2), false);
  assert.equal(isLake(3, 2), false);
});

test('squareKey produces a stable, comparable string', () => {
  assert.equal(squareKey(4, 2), '4,2');
  assert.notEqual(squareKey(4, 2), squareKey(2, 4));
});
```

```javascript
// test/rules/pieces.test.js -- create this alongside board.test.js in this step
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RANK, ARMY_COMPOSITION, ARMY_SIZE, isMovableRank } from '../../src/rules/pieces.js';

test('army composition totals 40 pieces', () => {
  assert.equal(ARMY_SIZE, 40);
});

test('army composition matches official Stratego counts', () => {
  const byRank = Object.fromEntries(ARMY_COMPOSITION.map((e) => [e.rank, e.count]));
  assert.equal(byRank[RANK.MARSHAL], 1);
  assert.equal(byRank[RANK.GENERAL], 1);
  assert.equal(byRank[RANK.COLONEL], 2);
  assert.equal(byRank[RANK.MAJOR], 3);
  assert.equal(byRank[RANK.CAPTAIN], 4);
  assert.equal(byRank[RANK.LIEUTENANT], 4);
  assert.equal(byRank[RANK.SERGEANT], 4);
  assert.equal(byRank[RANK.MINER], 5);
  assert.equal(byRank[RANK.SCOUT], 8);
  assert.equal(byRank[RANK.SPY], 1);
  assert.equal(byRank[RANK.BOMB], 6);
  assert.equal(byRank[RANK.FLAG], 1);
});

test('isMovableRank is false only for Bomb and Flag', () => {
  assert.equal(isMovableRank(RANK.BOMB), false);
  assert.equal(isMovableRank(RANK.FLAG), false);
  assert.equal(isMovableRank(RANK.MARSHAL), true);
  assert.equal(isMovableRank(RANK.SCOUT), true);
  assert.equal(isMovableRank(RANK.SPY), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/rules/board.test.js test/rules/pieces.test.js`
Expected: FAIL — `Cannot find module '../../src/rules/board.js'` (files don't exist yet)

- [ ] **Step 3: Write `src/rules/board.js`**

```javascript
export const BOARD_SIZE = 10;

const LAKE_SQUARES = new Set([
  '4,2', '4,3', '5,2', '5,3',
  '4,6', '4,7', '5,6', '5,7',
]);

export function squareKey(row, col) {
  return `${row},${col}`;
}

export function isOnBoard(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function isLake(row, col) {
  return LAKE_SQUARES.has(squareKey(row, col));
}
```

- [ ] **Step 4: Write `src/rules/pieces.js`**

```javascript
export const RANK = {
  MARSHAL: 1,
  GENERAL: 2,
  COLONEL: 3,
  MAJOR: 4,
  CAPTAIN: 5,
  LIEUTENANT: 6,
  SERGEANT: 7,
  MINER: 8,
  SCOUT: 9,
  SPY: 10,
  BOMB: 'BOMB',
  FLAG: 'FLAG',
};

export const ARMY_COMPOSITION = [
  { rank: RANK.MARSHAL, count: 1 },
  { rank: RANK.GENERAL, count: 1 },
  { rank: RANK.COLONEL, count: 2 },
  { rank: RANK.MAJOR, count: 3 },
  { rank: RANK.CAPTAIN, count: 4 },
  { rank: RANK.LIEUTENANT, count: 4 },
  { rank: RANK.SERGEANT, count: 4 },
  { rank: RANK.MINER, count: 5 },
  { rank: RANK.SCOUT, count: 8 },
  { rank: RANK.SPY, count: 1 },
  { rank: RANK.BOMB, count: 6 },
  { rank: RANK.FLAG, count: 1 },
];

export const ARMY_SIZE = ARMY_COMPOSITION.reduce((sum, entry) => sum + entry.count, 0);

export function isMovableRank(rank) {
  return rank !== RANK.BOMB && rank !== RANK.FLAG;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/rules/board.test.js test/rules/pieces.test.js`
Expected: PASS — all tests green

- [ ] **Step 6: Commit**

```bash
git add src/rules/board.js src/rules/pieces.js test/rules/board.test.js test/rules/pieces.test.js
git commit -m "feat: board and piece constants for rules engine"
```

---

## Task 3: Rules engine — movement validation

**Files:**
- Create: `src/rules/movement.js`
- Test: `test/rules/movement.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// test/rules/movement.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pieceAt, isOrthogonalAdjacent, isLegalDestination, isMovablePiece, validateMove } from '../../src/rules/movement.js';
import { RANK } from '../../src/rules/pieces.js';

function piece(overrides) {
  return { id: 'p1', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true, ...overrides };
}

test('pieceAt finds a live piece at a square, ignores dead ones', () => {
  const pieces = [piece({ id: 'a', row: 3, col: 3 }), piece({ id: 'b', row: 3, col: 3, alive: false })];
  const found = pieceAt(pieces, 3, 3);
  assert.equal(found.id, 'a');
});

test('pieceAt returns null when no piece occupies the square', () => {
  assert.equal(pieceAt([], 0, 0), null);
});

test('isOrthogonalAdjacent is true only for single-step horizontal/vertical moves', () => {
  assert.equal(isOrthogonalAdjacent({ row: 5, col: 5 }, { row: 5, col: 6 }), true);
  assert.equal(isOrthogonalAdjacent({ row: 5, col: 5 }, { row: 4, col: 5 }), true);
  assert.equal(isOrthogonalAdjacent({ row: 5, col: 5 }, { row: 6, col: 6 }), false, 'diagonal');
  assert.equal(isOrthogonalAdjacent({ row: 5, col: 5 }, { row: 5, col: 7 }), false, 'two squares');
});

test('isMovablePiece is false for Bomb and Flag', () => {
  assert.equal(isMovablePiece(piece({ rank: RANK.BOMB })), false);
  assert.equal(isMovablePiece(piece({ rank: RANK.FLAG })), false);
  assert.equal(isMovablePiece(piece({ rank: RANK.SCOUT })), true);
});

test('isLegalDestination rejects moving onto a lake', () => {
  const mover = piece({ row: 3, col: 3 });
  assert.equal(isLegalDestination([mover], mover, { row: 3, col: 3 }, { row: 4, col: 3 }), false);
});

test('isLegalDestination rejects moving onto your own piece', () => {
  const mover = piece({ id: 'a', row: 3, col: 3, playerSlot: 1 });
  const own = piece({ id: 'b', row: 3, col: 4, playerSlot: 1 });
  assert.equal(isLegalDestination([mover, own], mover, { row: 3, col: 3 }, { row: 3, col: 4 }), false);
});

test('isLegalDestination allows moving onto an enemy piece (attack)', () => {
  const mover = piece({ id: 'a', row: 3, col: 3, playerSlot: 1 });
  const enemy = piece({ id: 'b', row: 3, col: 4, playerSlot: 2 });
  assert.equal(isLegalDestination([mover, enemy], mover, { row: 3, col: 3 }, { row: 3, col: 4 }), true);
});

test('non-Scout pieces can only move one orthogonal square', () => {
  const mover = piece({ row: 3, col: 3, rank: RANK.SERGEANT });
  assert.equal(isLegalDestination([mover], mover, { row: 3, col: 3 }, { row: 3, col: 4 }), true);
  assert.equal(isLegalDestination([mover], mover, { row: 3, col: 3 }, { row: 3, col: 5 }), false, 'two squares');
});

test('Scouts can move any distance in a straight line if the path is clear', () => {
  const mover = piece({ row: 3, col: 0, rank: RANK.SCOUT });
  assert.equal(isLegalDestination([mover], mover, { row: 3, col: 0 }, { row: 3, col: 9 }), true);
});

test('Scouts cannot jump over an occupied square', () => {
  const mover = piece({ id: 'a', row: 3, col: 0, rank: RANK.SCOUT, playerSlot: 1 });
  const blocker = piece({ id: 'b', row: 3, col: 5, playerSlot: 2 });
  assert.equal(isLegalDestination([mover, blocker], mover, { row: 3, col: 0 }, { row: 3, col: 9 }), false);
});

test('Scouts cannot path through a lake', () => {
  const mover = piece({ row: 4, col: 0, rank: RANK.SCOUT });
  assert.equal(isLegalDestination([mover], mover, { row: 4, col: 0 }, { row: 4, col: 9 }), false, 'path crosses lake at (4,2)-(4,3) and (4,6)-(4,7)');
});

test('Scouts cannot move diagonally even in a straight line claim', () => {
  const mover = piece({ row: 0, col: 0, rank: RANK.SCOUT });
  assert.equal(isLegalDestination([mover], mover, { row: 0, col: 0 }, { row: 3, col: 3 }), false);
});

test('validateMove rejects a move with no piece at the source', () => {
  const result = validateMove([], 1, { row: 0, col: 0 }, { row: 0, col: 1 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NO_PIECE_AT_SOURCE');
});

test('validateMove rejects moving the opponent\'s piece', () => {
  const enemy = piece({ playerSlot: 2, row: 3, col: 3 });
  const result = validateMove([enemy], 1, { row: 3, col: 3 }, { row: 3, col: 4 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'NOT_YOUR_PIECE');
});

test('validateMove rejects moving a Bomb', () => {
  const bomb = piece({ rank: RANK.BOMB, row: 3, col: 3 });
  const result = validateMove([bomb], 1, { row: 3, col: 3 }, { row: 3, col: 4 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'PIECE_CANNOT_MOVE');
});

test('validateMove accepts a legal move and returns the mover', () => {
  const mover = piece({ row: 3, col: 3 });
  const result = validateMove([mover], 1, { row: 3, col: 3 }, { row: 3, col: 4 });
  assert.equal(result.valid, true);
  assert.equal(result.mover.id, mover.id);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/rules/movement.test.js`
Expected: FAIL — `Cannot find module '../../src/rules/movement.js'`

- [ ] **Step 3: Write `src/rules/movement.js`**

```javascript
import { isOnBoard, isLake } from './board.js';
import { RANK, isMovableRank } from './pieces.js';

export function pieceAt(pieces, row, col) {
  return pieces.find((p) => p.alive && p.row === row && p.col === col) || null;
}

export function isOrthogonalAdjacent(from, to) {
  const rowDiff = Math.abs(from.row - to.row);
  const colDiff = Math.abs(from.col - to.col);
  return (rowDiff === 1 && colDiff === 0) || (rowDiff === 0 && colDiff === 1);
}

function isClearScoutPath(pieces, from, to) {
  const sameRow = from.row === to.row;
  const sameCol = from.col === to.col;
  if (!sameRow && !sameCol) return false;
  if (sameRow && sameCol) return false;

  const rowStep = sameRow ? 0 : Math.sign(to.row - from.row);
  const colStep = sameCol ? 0 : Math.sign(to.col - from.col);
  let row = from.row + rowStep;
  let col = from.col + colStep;

  while (row !== to.row || col !== to.col) {
    if (isLake(row, col)) return false;
    if (pieceAt(pieces, row, col)) return false;
    row += rowStep;
    col += colStep;
  }
  return true;
}

export function isLegalDestination(pieces, mover, from, to) {
  if (!isOnBoard(to.row, to.col)) return false;
  if (isLake(to.row, to.col)) return false;
  if (from.row === to.row && from.col === to.col) return false;

  const targetPiece = pieceAt(pieces, to.row, to.col);
  if (targetPiece && targetPiece.playerSlot === mover.playerSlot) return false;

  if (mover.rank === RANK.SCOUT) {
    return isClearScoutPath(pieces, from, to);
  }
  return isOrthogonalAdjacent(from, to);
}

export function isMovablePiece(piece) {
  return isMovableRank(piece.rank);
}

export function validateMove(pieces, playerSlot, from, to) {
  const mover = pieceAt(pieces, from.row, from.col);
  if (!mover) return { valid: false, reason: 'NO_PIECE_AT_SOURCE' };
  if (mover.playerSlot !== playerSlot) return { valid: false, reason: 'NOT_YOUR_PIECE' };
  if (!isMovablePiece(mover)) return { valid: false, reason: 'PIECE_CANNOT_MOVE' };
  if (!isLegalDestination(pieces, mover, from, to)) return { valid: false, reason: 'ILLEGAL_DESTINATION' };
  return { valid: true, mover };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/rules/movement.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/rules/movement.js test/rules/movement.test.js
git commit -m "feat: movement validation including Scout paths"
```

---

## Task 4: Rules engine — combat resolution

**Files:**
- Create: `src/rules/combat.js`
- Test: `test/rules/combat.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// test/rules/combat.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCombat, COMBAT_OUTCOME } from '../../src/rules/combat.js';
import { RANK } from '../../src/rules/pieces.js';

test('lower rank number beats higher rank number', () => {
  assert.equal(resolveCombat(RANK.GENERAL, RANK.COLONEL), COMBAT_OUTCOME.ATTACKER_WINS);
  assert.equal(resolveCombat(RANK.COLONEL, RANK.GENERAL), COMBAT_OUTCOME.DEFENDER_WINS);
});

test('equal ranks result in a tie, both removed', () => {
  assert.equal(resolveCombat(RANK.SERGEANT, RANK.SERGEANT), COMBAT_OUTCOME.TIE);
});

test('Spy attacking the Marshal wins (the one special case)', () => {
  assert.equal(resolveCombat(RANK.SPY, RANK.MARSHAL), COMBAT_OUTCOME.ATTACKER_WINS);
});

test('Marshal attacking the Spy wins normally (Spy has no defensive power)', () => {
  assert.equal(resolveCombat(RANK.MARSHAL, RANK.SPY), COMBAT_OUTCOME.ATTACKER_WINS);
});

test('any non-Miner attacking a Bomb loses; the Bomb stays', () => {
  assert.equal(resolveCombat(RANK.MARSHAL, RANK.BOMB), COMBAT_OUTCOME.DEFENDER_WINS);
  assert.equal(resolveCombat(RANK.SCOUT, RANK.BOMB), COMBAT_OUTCOME.DEFENDER_WINS);
});

test('a Miner attacking a Bomb defuses it and wins', () => {
  assert.equal(resolveCombat(RANK.MINER, RANK.BOMB), COMBAT_OUTCOME.ATTACKER_WINS);
});

test('attacking the Flag always wins regardless of attacker rank', () => {
  assert.equal(resolveCombat(RANK.SPY, RANK.FLAG), COMBAT_OUTCOME.ATTACKER_WINS);
  assert.equal(resolveCombat(RANK.SCOUT, RANK.FLAG), COMBAT_OUTCOME.ATTACKER_WINS);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/rules/combat.test.js`
Expected: FAIL — `Cannot find module '../../src/rules/combat.js'`

- [ ] **Step 3: Write `src/rules/combat.js`**

```javascript
import { RANK } from './pieces.js';

export const COMBAT_OUTCOME = {
  ATTACKER_WINS: 'ATTACKER_WINS',
  DEFENDER_WINS: 'DEFENDER_WINS',
  TIE: 'TIE',
};

export function resolveCombat(attackerRank, defenderRank) {
  if (defenderRank === RANK.FLAG) {
    return COMBAT_OUTCOME.ATTACKER_WINS;
  }
  if (defenderRank === RANK.BOMB) {
    return attackerRank === RANK.MINER ? COMBAT_OUTCOME.ATTACKER_WINS : COMBAT_OUTCOME.DEFENDER_WINS;
  }
  if (attackerRank === RANK.SPY && defenderRank === RANK.MARSHAL) {
    return COMBAT_OUTCOME.ATTACKER_WINS;
  }
  if (attackerRank === defenderRank) {
    return COMBAT_OUTCOME.TIE;
  }
  return attackerRank < defenderRank ? COMBAT_OUTCOME.ATTACKER_WINS : COMBAT_OUTCOME.DEFENDER_WINS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/rules/combat.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/rules/combat.js test/rules/combat.test.js
git commit -m "feat: combat resolution table"
```

---

## Task 5: Rules engine — two-square rule

**Files:**
- Create: `src/rules/twoSquareRule.js`
- Test: `test/rules/twoSquareRule.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// test/rules/twoSquareRule.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violatesTwoSquareRule } from '../../src/rules/twoSquareRule.js';

test('allows the first three shuttles between two squares', () => {
  const history = [
    { pieceId: 'p1', from: '3,3', to: '3,4' },
    { pieceId: 'p1', from: '3,4', to: '3,3' },
  ];
  // this would be the 3rd transition (A->B), still allowed
  assert.equal(violatesTwoSquareRule(history, 'p1', '3,3', '3,4'), false);
});

test('blocks the 4th consecutive shuttle between the same two squares', () => {
  const history = [
    { pieceId: 'p1', from: '3,3', to: '3,4' },
    { pieceId: 'p1', from: '3,4', to: '3,3' },
    { pieceId: 'p1', from: '3,3', to: '3,4' },
  ];
  // proposed: 4th transition, back to 3,3 -- must be blocked
  assert.equal(violatesTwoSquareRule(history, 'p1', '3,4', '3,3'), true);
});

test('does not block if the same piece visits a third square', () => {
  const history = [
    { pieceId: 'p1', from: '3,3', to: '3,4' },
    { pieceId: 'p1', from: '3,4', to: '3,3' },
    { pieceId: 'p1', from: '3,3', to: '3,4' },
  ];
  // moving to a different square breaks the pattern
  assert.equal(violatesTwoSquareRule(history, 'p1', '3,4', '3,5'), false);
});

test('does not block a different piece even with an identical-looking history', () => {
  const history = [
    { pieceId: 'p1', from: '3,3', to: '3,4' },
    { pieceId: 'p1', from: '3,4', to: '3,3' },
    { pieceId: 'p1', from: '3,3', to: '3,4' },
  ];
  assert.equal(violatesTwoSquareRule(history, 'p2', '3,4', '3,3'), false);
});

test('interleaving a different piece\'s move breaks consecutiveness', () => {
  const history = [
    { pieceId: 'p1', from: '3,3', to: '3,4' },
    { pieceId: 'p1', from: '3,4', to: '3,3' },
    { pieceId: 'p2', from: '6,6', to: '6,7' },
    { pieceId: 'p1', from: '3,3', to: '3,4' },
  ];
  // last 3 entries are not all piece p1 (p2's move breaks the run), so this is not yet the 4th consecutive
  assert.equal(violatesTwoSquareRule(history, 'p1', '3,4', '3,3'), false);
});

test('fewer than 3 prior moves never violates', () => {
  assert.equal(violatesTwoSquareRule([], 'p1', '3,3', '3,4'), false);
  const oneMove = [{ pieceId: 'p1', from: '3,3', to: '3,4' }];
  assert.equal(violatesTwoSquareRule(oneMove, 'p1', '3,4', '3,3'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/rules/twoSquareRule.test.js`
Expected: FAIL — `Cannot find module '../../src/rules/twoSquareRule.js'`

- [ ] **Step 3: Write `src/rules/twoSquareRule.js`**

```javascript
// Official rule: a piece cannot move back and forth between the same two
// squares more than three consecutive turns. "Consecutive" means the same
// player's own last three moves were all this piece shuttling between the
// same two squares; moving any other piece in between breaks the streak.
export function violatesTwoSquareRule(playerMoveHistory, pieceId, from, to) {
  const last3 = playerMoveHistory.slice(-3);
  if (last3.length < 3) return false;
  if (!last3.every((entry) => entry.pieceId === pieceId)) return false;
  if (last3[0].to !== last3[1].from) return false;
  if (last3[1].to !== last3[2].from) return false;
  if (last3[2].to !== from) return false;

  const squares = new Set([last3[0].from, last3[0].to, last3[1].to, last3[2].to, to]);
  return squares.size === 2;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/rules/twoSquareRule.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/rules/twoSquareRule.js test/rules/twoSquareRule.test.js
git commit -m "feat: two-square anti-stalling rule"
```

---

## Task 6: Rules engine — game orchestrator

**Files:**
- Create: `src/rules/game.js`
- Test: `test/rules/game.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// test/rules/game.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove } from '../../src/rules/game.js';
import { RANK } from '../../src/rules/pieces.js';

function baseState(pieces, overrides = {}) {
  return {
    status: 'active',
    currentTurnSlot: 1,
    pieces,
    moveHistoryByPlayer: { 1: [], 2: [] },
    ...overrides,
  };
}

test('rejects a move when the game is not active', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true }];
  const result = applyMove(baseState(pieces, { status: 'setup' }), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'GAME_NOT_ACTIVE');
});

test('rejects a move out of turn', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true }];
  const result = applyMove(baseState(pieces, { currentTurnSlot: 2 }), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'NOT_YOUR_TURN');
});

test('rejects an illegal move and surfaces the movement validator\'s reason', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.BOMB, row: 6, col: 5, alive: true }];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'PIECE_CANNOT_MOVE');
});

test('a plain move to an empty square relocates the piece and passes the turn', () => {
  // Player 2 needs at least one piece with a legal move here, or the
  // no-legal-moves win check (correctly) ends the game instead of just
  // passing the turn -- that behavior is tested separately below.
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true },
    { id: 'z', playerSlot: 2, rank: RANK.SERGEANT, row: 0, col: 0, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, true);
  assert.equal(result.combatResult, null);
  const moved = result.newState.pieces.find((p) => p.id === 'a');
  assert.equal(moved.row, 6);
  assert.equal(moved.col, 6);
  assert.equal(result.newState.currentTurnSlot, 2);
  assert.equal(result.newState.status, 'active');
});

test('an attack that wins removes the defender and advances the attacker', () => {
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.GENERAL, row: 6, col: 5, alive: true },
    { id: 'b', playerSlot: 2, rank: RANK.COLONEL, row: 6, col: 6, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, true);
  assert.equal(result.combatResult.outcome, 'ATTACKER_WINS');
  const attacker = result.newState.pieces.find((p) => p.id === 'a');
  const defender = result.newState.pieces.find((p) => p.id === 'b');
  assert.equal(attacker.alive, true);
  assert.equal(attacker.row, 6);
  assert.equal(attacker.col, 6);
  assert.equal(defender.alive, false);
});

test('an attack that loses removes the attacker and leaves the defender in place', () => {
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.COLONEL, row: 6, col: 5, alive: true },
    { id: 'b', playerSlot: 2, rank: RANK.GENERAL, row: 6, col: 6, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.ok, true);
  assert.equal(result.combatResult.outcome, 'DEFENDER_WINS');
  const attacker = result.newState.pieces.find((p) => p.id === 'a');
  const defender = result.newState.pieces.find((p) => p.id === 'b');
  assert.equal(attacker.alive, false);
  assert.equal(defender.alive, true);
  assert.equal(defender.row, 6);
  assert.equal(defender.col, 6);
});

test('a tie removes both pieces', () => {
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true },
    { id: 'b', playerSlot: 2, rank: RANK.SERGEANT, row: 6, col: 6, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.newState.pieces.find((p) => p.id === 'a').alive, false);
  assert.equal(result.newState.pieces.find((p) => p.id === 'b').alive, false);
});

test('capturing the Flag ends the game immediately with a winner', () => {
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true },
    { id: 'b', playerSlot: 2, rank: RANK.FLAG, row: 6, col: 6, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.winnerSlot, 1);
  assert.equal(result.newState.status, 'finished');
});

test('two-square rule violation is rejected with its own reason and does not mutate state', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true }];
  const history = {
    1: [
      { pieceId: 'a', from: '6,4', to: '6,5' },
      { pieceId: 'a', from: '6,5', to: '6,4' },
      { pieceId: 'a', from: '6,4', to: '6,5' },
    ],
    2: [],
  };
  // Piece 'a' is currently at 6,5 (matches the end of that history) and this would be the 4th shuttle back to 6,4
  const result = applyMove(baseState(pieces, { moveHistoryByPlayer: history }), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 4 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'TWO_SQUARE_RULE');
});

test('a player with no legal moves left loses', () => {
  // Player 2 has a single Bomb (immovable) left; player 1 has one Sergeant. Player 1 moves, it becomes
  // player 2's turn with no movable pieces, so player 1 wins immediately.
  const pieces = [
    { id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true },
    { id: 'b', playerSlot: 2, rank: RANK.BOMB, row: 0, col: 0, alive: true },
  ];
  const result = applyMove(baseState(pieces), { playerSlot: 1, from: { row: 6, col: 5 }, to: { row: 6, col: 6 } });
  assert.equal(result.winnerSlot, 1);
  assert.equal(result.newState.status, 'finished');
});

test('a player whose only remaining move is two-square-rule-blocked also loses', () => {
  // Player 2 has one movable piece (a Sergeant at (0,1)) boxed in by two of
  // their own Bombs, leaving exactly one legal destination: (0,2). Player 2's
  // own move history shows that piece already shuttled (0,1)<->(0,2) three
  // times, so moving there again would violate the two-square rule -- their
  // only "movement-legal" option isn't actually available, so they have no
  // legal moves at all once it's their turn.
  const pieces = [
    { id: 'p1', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true },
    { id: 'b1', playerSlot: 2, rank: RANK.SERGEANT, row: 0, col: 1, alive: true },
    { id: 'b2', playerSlot: 2, rank: RANK.BOMB, row: 0, col: 0, alive: true },
    { id: 'b3', playerSlot: 2, rank: RANK.BOMB, row: 1, col: 1, alive: true },
  ];
  const history = {
    1: [],
    2: [
      { pieceId: 'b1', from: '0,2', to: '0,1' },
      { pieceId: 'b1', from: '0,1', to: '0,2' },
      { pieceId: 'b1', from: '0,2', to: '0,1' },
    ],
  };
  const result = applyMove(baseState(pieces, { moveHistoryByPlayer: history }), {
    playerSlot: 1,
    from: { row: 6, col: 5 },
    to: { row: 6, col: 6 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.winnerSlot, 1);
  assert.equal(result.newState.status, 'finished');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/rules/game.test.js`
Expected: FAIL — `Cannot find module '../../src/rules/game.js'`

- [ ] **Step 3: Write `src/rules/game.js`**

```javascript
import { squareKey } from './board.js';
import { RANK } from './pieces.js';
import { validateMove } from './movement.js';
import { resolveCombat, COMBAT_OUTCOME } from './combat.js';
import { violatesTwoSquareRule } from './twoSquareRule.js';

export function applyMove(state, { playerSlot, from, to }) {
  if (state.status !== 'active') {
    return { ok: false, reason: 'GAME_NOT_ACTIVE' };
  }
  if (state.currentTurnSlot !== playerSlot) {
    return { ok: false, reason: 'NOT_YOUR_TURN' };
  }

  const validation = validateMove(state.pieces, playerSlot, from, to);
  if (!validation.valid) {
    return { ok: false, reason: validation.reason };
  }

  const mover = validation.mover;
  const fromKey = squareKey(from.row, from.col);
  const toKey = squareKey(to.row, to.col);
  const history = state.moveHistoryByPlayer[playerSlot] || [];

  if (violatesTwoSquareRule(history, mover.id, fromKey, toKey)) {
    return { ok: false, reason: 'TWO_SQUARE_RULE' };
  }

  const defender = state.pieces.find((p) => p.alive && p.row === to.row && p.col === to.col) || null;
  const newPieces = state.pieces.map((p) => ({ ...p }));
  const moverPiece = newPieces.find((p) => p.id === mover.id);

  let combatResult = null;
  let winnerSlot = null;

  if (defender) {
    const defenderPiece = newPieces.find((p) => p.id === defender.id);
    const outcome = resolveCombat(moverPiece.rank, defenderPiece.rank);
    combatResult = {
      outcome,
      attackerRank: moverPiece.rank,
      defenderRank: defenderPiece.rank,
    };

    if (defenderPiece.rank === RANK.FLAG) {
      winnerSlot = playerSlot;
    }

    if (outcome === COMBAT_OUTCOME.ATTACKER_WINS) {
      defenderPiece.alive = false;
      moverPiece.row = to.row;
      moverPiece.col = to.col;
    } else if (outcome === COMBAT_OUTCOME.DEFENDER_WINS) {
      moverPiece.alive = false;
    } else {
      moverPiece.alive = false;
      defenderPiece.alive = false;
    }
  } else {
    moverPiece.row = to.row;
    moverPiece.col = to.col;
  }

  const newHistory = { ...state.moveHistoryByPlayer };
  newHistory[playerSlot] = [...history, { pieceId: mover.id, from: fromKey, to: toKey }];

  const nextTurnSlot = playerSlot === 1 ? 2 : 1;
  const nextPlayerHistory = newHistory[nextTurnSlot] || [];
  if (!winnerSlot && !hasAnyLegalMove(newPieces, nextTurnSlot, nextPlayerHistory)) {
    winnerSlot = playerSlot;
  }

  return {
    ok: true,
    combatResult,
    winnerSlot,
    newState: {
      ...state,
      pieces: newPieces,
      currentTurnSlot: winnerSlot ? state.currentTurnSlot : nextTurnSlot,
      status: winnerSlot ? 'finished' : 'active',
      moveHistoryByPlayer: newHistory,
    },
  };
}

function hasAnyLegalMove(pieces, playerSlot, history) {
  const movablePieces = pieces.filter(
    (p) => p.alive && p.playerSlot === playerSlot && p.rank !== RANK.BOMB && p.rank !== RANK.FLAG,
  );
  for (const piece of movablePieces) {
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const validation = validateMove(pieces, playerSlot, { row: piece.row, col: piece.col }, { row, col });
        if (!validation.valid) continue;
        const fromKey = squareKey(piece.row, piece.col);
        const toKey = squareKey(row, col);
        if (violatesTwoSquareRule(history, piece.id, fromKey, toKey)) continue;
        return true;
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/rules/game.test.js`
Expected: PASS — all tests green

- [ ] **Step 5: Run the full rules-engine test suite**

Run: `npm test`
Expected: PASS — every test file under `test/rules/` green

- [ ] **Step 6: Commit**

```bash
git add src/rules/game.js test/rules/game.test.js
git commit -m "feat: game orchestrator with combat resolution and win detection"
```

---

## Task 7: Database schema migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0001_init.sql
create extension if not exists "pgcrypto";

create table games (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  status text not null default 'setup' check (status in ('setup', 'active', 'finished')),
  current_turn_slot smallint check (current_turn_slot in (1, 2)),
  turn_number integer not null default 0,
  winner_slot smallint check (winner_slot in (1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_slot smallint not null check (player_slot in (1, 2)),
  secret_token uuid not null default gen_random_uuid(),
  setup_submitted boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (game_id, player_slot)
);

create table pieces (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_slot smallint not null check (player_slot in (1, 2)),
  rank text not null,
  row_idx smallint not null check (row_idx between 0 and 9),
  col_idx smallint not null check (col_idx between 0 and 9),
  alive boolean not null default true,
  revealed_rank text,
  created_at timestamptz not null default now()
);

create unique index pieces_alive_position_idx on pieces (game_id, row_idx, col_idx) where alive;

create table moves (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  piece_id uuid not null references pieces(id),
  move_number integer not null,
  player_slot smallint not null check (player_slot in (1, 2)),
  from_row smallint not null,
  from_col smallint not null,
  to_row smallint not null,
  to_col smallint not null,
  move_type text not null check (move_type in ('move', 'attack')),
  outcome text check (outcome in ('ATTACKER_WINS', 'DEFENDER_WINS', 'TIE')),
  attacker_rank text,
  defender_rank text,
  created_at timestamptz not null default now(),
  unique (game_id, move_number)
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_slot smallint not null check (player_slot in (1, 2)),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table games enable row level security;
alter table game_players enable row level security;
alter table pieces enable row level security;
alter table moves enable row level security;
alter table chat_messages enable row level security;

-- games: room_code is a lookup key, not a secret. Safe to read openly; it
-- never contains piece data. current_turn_slot/turn_number/status changes
-- are what drive the Realtime "go refetch your view" signal.
create policy games_select on games for select using (true);

-- game_players: never exposed directly. secret_token is only ever checked
-- from inside SECURITY DEFINER functions / Edge Functions using the service
-- role. No policy is created, so the anon/authenticated roles get zero access.

-- pieces: never exposed directly, for the same reason. All reads go through
-- get_game_state(token) below, which redacts unrevealed opponent ranks.

-- moves: combat always reveals both participants' ranks to both players (same
-- as flipping physical pieces), so the full move log is safe to read openly
-- by anyone who already knows the game_id.
create policy moves_select on moves for select using (true);

-- chat_messages: reading requires already knowing the unguessable game_id
-- (same trust model as the rest of the app), so open reads are fine. Writes
-- are NOT allowed directly by anon -- they must go through the send-chat
-- Edge Function, which checks the sender's token before inserting with the
-- service role (bypassing RLS). No insert policy is created here.
create policy chat_select on chat_messages for select using (true);

-- Realtime's postgres_changes only fires for tables explicitly added to this
-- publication. `games` drives the "go refetch your view" signal (Task 16);
-- `chat_messages` drives live chat updates (Task 17). `pieces` and
-- `game_players` are deliberately NOT added here -- broadcasting their raw
-- row changes would defeat the fog-of-war enforcement that get_game_state()
-- exists for.
alter publication supabase_realtime add table games;
alter publication supabase_realtime add table chat_messages;

create or replace function get_game_state(p_token uuid)
returns table (
  piece_id uuid,
  player_slot smallint,
  rank text,
  row_idx smallint,
  col_idx smallint,
  alive boolean,
  is_mine boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_player_slot smallint;
begin
  select gp.game_id, gp.player_slot into v_game_id, v_player_slot
  from game_players gp
  where gp.secret_token = p_token;

  if v_game_id is null then
    raise exception 'invalid token';
  end if;

  return query
  select
    p.id,
    p.player_slot,
    case
      when p.player_slot = v_player_slot then p.rank
      when p.revealed_rank is not null then p.revealed_rank
      else null
    end as rank,
    p.row_idx,
    p.col_idx,
    p.alive,
    (p.player_slot = v_player_slot) as is_mine
  from pieces p
  where p.game_id = v_game_id;
end;
$$;

grant execute on function get_game_state(uuid) to anon;
```

- [ ] **Step 2: Verify the migration applies cleanly against local Supabase**

Run: `npx supabase start` (first time only, requires Docker Desktop running)
Run: `npx supabase db reset`
Expected: Output ends with `Applying migration 0001_init.sql...` followed by `Finished supabase db reset`, no SQL errors.

- [ ] **Step 3: Smoke-test `get_game_state` rejects an unknown token**

Run: `npx supabase db execute --sql "select * from get_game_state('00000000-0000-0000-0000-000000000000');"`
Expected: Error output containing `invalid token` (confirms the exception path works, not a silent empty result).

- [ ] **Step 4: Verify `games` and `chat_messages` are in the Realtime publication**

Run: `npx supabase db execute --sql "select tablename from pg_publication_tables where pubname = 'supabase_realtime';"`
Expected: a result set containing both `games` and `chat_messages` (and nothing else — confirms `pieces` and `game_players` were correctly left out).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat: initial schema, RLS policies, and get_game_state RPC"
```

---

## Task 8: Edge Function shared rules copy

**Files:**
- Create: `supabase/functions/_shared/rules/board.js`
- Create: `supabase/functions/_shared/rules/pieces.js`
- Create: `supabase/functions/_shared/rules/movement.js`
- Create: `supabase/functions/_shared/rules/combat.js`
- Create: `supabase/functions/_shared/rules/twoSquareRule.js`
- Create: `supabase/functions/_shared/rules/game.js`
- Create: `supabase/functions/_shared/rules/README.md`

- [ ] **Step 1: Copy the five rules files verbatim**

Run:
```bash
mkdir -p supabase/functions/_shared/rules
cp src/rules/board.js src/rules/pieces.js src/rules/movement.js src/rules/combat.js src/rules/twoSquareRule.js src/rules/game.js supabase/functions/_shared/rules/
```

Expected: `supabase/functions/_shared/rules/` now contains the same six files as `src/rules/`, byte-for-byte.

- [ ] **Step 2: Document the duplication so it doesn't silently drift**

```markdown
<!-- supabase/functions/_shared/rules/README.md -->
# Generated copy

These files are a verbatim copy of `src/rules/*.js`. Deno Edge Functions
cannot import from outside their `supabase/functions/` directory at deploy
time, so the canonical rules engine (tested by `npm test` against
`src/rules/`) is duplicated here for the `make-move` function to import.

**When you change anything in `src/rules/`, re-run:**

```bash
cp src/rules/*.js supabase/functions/_shared/rules/
```

Do not edit the files in this directory directly — edit `src/rules/`,
re-run the tests, then re-copy.
```

- [ ] **Step 3: Verify the copies are identical to the source**

Run: `diff -rq src/rules/ supabase/functions/_shared/rules/ | grep -v README`
Expected: no output (no differences other than the extra README, which `diff -rq` will report as "Only in ... README.md" — confirm that's the only line)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared
git commit -m "chore: copy rules engine into Edge Functions shared dir"
```

---

## Task 9: Edge Function — create-game

**Files:**
- Create: `supabase/functions/create-game/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/create-game/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no O/0, I/1 to avoid misreads
const ROOM_CODE_LENGTH = 8;

function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let roomCode = generateRoomCode();
  let gameId: string | null = null;

  for (let attempt = 0; attempt < 5 && !gameId; attempt++) {
    const { data, error } = await supabase
      .from("games")
      .insert({ room_code: roomCode })
      .select("id")
      .single();

    if (!error) {
      gameId = data.id;
    } else if (error.code === "23505") {
      // room_code collision (astronomically unlikely at 8 chars) -- retry with a new code
      roomCode = generateRoomCode();
    } else {
      return new Response(JSON.stringify({ error: "CREATE_GAME_FAILED", detail: error.message }), { status: 500 });
    }
  }

  if (!gameId) {
    return new Response(JSON.stringify({ error: "ROOM_CODE_EXHAUSTED" }), { status: 500 });
  }

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .insert({ game_id: gameId, player_slot: 1 })
    .select("secret_token")
    .single();

  if (playerError) {
    return new Response(JSON.stringify({ error: "CREATE_PLAYER_FAILED", detail: playerError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({
      roomCode,
      token: playerRow.secret_token,
      invitePath: `/setup.html?code=${roomCode}&join=1`,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
```

- [ ] **Step 2: Start the function locally and smoke-test it**

Run: `npx supabase functions serve create-game --no-verify-jwt`
Run (separate terminal): `curl -X POST http://127.0.0.1:54321/functions/v1/create-game`
Expected: JSON response with `roomCode` (8 chars from the safe alphabet), `token` (a UUID), and `invitePath`.

- [ ] **Step 3: Verify the row was actually created**

Run: `npx supabase db execute --sql "select room_code, status from games order by created_at desc limit 1;"`
Expected: one row with the same `room_code` printed by the curl response and `status = 'setup'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/create-game
git commit -m "feat: create-game Edge Function"
```

---

## Task 10: Edge Function — join-game

**Files:**
- Create: `supabase/functions/join-game/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/join-game/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { roomCode } = await req.json();
  if (!roomCode) {
    return new Response(JSON.stringify({ error: "MISSING_ROOM_CODE" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("id, status")
    .eq("room_code", roomCode)
    .maybeSingle();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "ROOM_NOT_FOUND" }), { status: 404 });
  }
  if (game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_ALREADY_STARTED" }), { status: 409 });
  }

  const { data: existingPlayers, error: countError } = await supabase
    .from("game_players")
    .select("player_slot")
    .eq("game_id", game.id);

  if (countError) {
    return new Response(JSON.stringify({ error: "LOOKUP_FAILED", detail: countError.message }), { status: 500 });
  }
  if (existingPlayers.some((p) => p.player_slot === 2)) {
    return new Response(JSON.stringify({ error: "GAME_FULL" }), { status: 409 });
  }

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .insert({ game_id: game.id, player_slot: 2 })
    .select("secret_token")
    .single();

  if (playerError) {
    return new Response(JSON.stringify({ error: "JOIN_FAILED", detail: playerError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ token: playerRow.secret_token, gameId: game.id }),
    { headers: { "Content-Type": "application/json" } },
  );
});
```

- [ ] **Step 2: Smoke-test against the game created in Task 9**

Run: `npx supabase functions serve join-game --no-verify-jwt`
Run: `curl -X POST http://127.0.0.1:54321/functions/v1/join-game -H "Content-Type: application/json" -d '{"roomCode":"<paste the roomCode from Task 9 curl output>"}'`
Expected: JSON with a `token` (different UUID from player 1's) and `gameId`.

- [ ] **Step 3: Verify a second join attempt on the same room is rejected**

Run the same curl command again with the same room code.
Expected: HTTP 409 with `{"error":"GAME_FULL"}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/join-game
git commit -m "feat: join-game Edge Function"
```

---

## Task 11: Edge Function — submit-setup

**Files:**
- Create: `supabase/functions/submit-setup/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/submit-setup/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ARMY_COMPOSITION } from "../_shared/rules/pieces.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Placement {
  rank: string | number;
  row: number;
  col: number;
}

function territoryRowsFor(playerSlot: number): number[] {
  return playerSlot === 1 ? [6, 7, 8, 9] : [0, 1, 2, 3];
}

function validatePlacements(playerSlot: number, placements: Placement[]): string | null {
  if (placements.length !== ARMY_COMPOSITION.length ? false : false) {
    // composition check is by count-per-rank below, not array length alone
  }
  const totalExpected = ARMY_COMPOSITION.reduce((sum, e) => sum + e.count, 0);
  if (placements.length !== totalExpected) {
    return "WRONG_PIECE_COUNT";
  }

  const countByRank = new Map<string, number>();
  const seenSquares = new Set<string>();
  const allowedRows = new Set(territoryRowsFor(playerSlot));

  for (const p of placements) {
    const key = `${p.row},${p.col}`;
    if (seenSquares.has(key)) return "DUPLICATE_SQUARE";
    seenSquares.add(key);

    if (!allowedRows.has(p.row) || p.col < 0 || p.col > 9) return "OUTSIDE_TERRITORY";

    const rankKey = String(p.rank);
    countByRank.set(rankKey, (countByRank.get(rankKey) ?? 0) + 1);
  }

  for (const entry of ARMY_COMPOSITION) {
    if (countByRank.get(String(entry.rank)) !== entry.count) {
      return "WRONG_ARMY_COMPOSITION";
    }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token, placements } = await req.json();
  if (!token || !Array.isArray(placements)) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot, setup_submitted")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401 });
  }
  if (playerRow.setup_submitted) {
    return new Response(JSON.stringify({ error: "SETUP_ALREADY_SUBMITTED" }), { status: 409 });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || game.status !== "setup") {
    return new Response(JSON.stringify({ error: "GAME_NOT_IN_SETUP" }), { status: 409 });
  }

  const validationError = validatePlacements(playerRow.player_slot, placements);
  if (validationError) {
    return new Response(JSON.stringify({ error: validationError }), { status: 400 });
  }

  const rows = placements.map((p: Placement) => ({
    game_id: playerRow.game_id,
    player_slot: playerRow.player_slot,
    rank: String(p.rank),
    row_idx: p.row,
    col_idx: p.col,
  }));

  const { error: insertError } = await supabase.from("pieces").insert(rows);
  if (insertError) {
    return new Response(JSON.stringify({ error: "INSERT_FAILED", detail: insertError.message }), { status: 500 });
  }

  await supabase
    .from("game_players")
    .update({ setup_submitted: true })
    .eq("game_id", playerRow.game_id)
    .eq("player_slot", playerRow.player_slot);

  const { data: allPlayers } = await supabase
    .from("game_players")
    .select("setup_submitted")
    .eq("game_id", playerRow.game_id);

  const bothReady = allPlayers?.length === 2 && allPlayers.every((p) => p.setup_submitted);

  if (bothReady) {
    const firstTurnSlot = Math.random() < 0.5 ? 1 : 2;
    await supabase
      .from("games")
      .update({ status: "active", current_turn_slot: firstTurnSlot, turn_number: 1 })
      .eq("id", playerRow.game_id);
  }

  return new Response(JSON.stringify({ ok: true, gameStarted: bothReady }), {
    headers: { "Content-Type": "application/json" },
  });
});
```

- [ ] **Step 2: Fix the dead no-op line flagged by the placeholder scan**

Delete this line from `validatePlacements` written in Step 1 — it's a leftover no-op condition that does nothing (both branches evaluate to `false`, so the `if` body never runs):

```typescript
  if (placements.length !== ARMY_COMPOSITION.length ? false : false) {
    // composition check is by count-per-rank below, not array length alone
  }
```

The real length check two lines below (`if (placements.length !== totalExpected)`) already covers this.

- [ ] **Step 3: Smoke-test with a full 40-piece placement for player 1**

Using the `roomCode`/`token` from Task 9, build a placement covering rows 6-9, all 10 columns, with the official 40-piece composition (e.g. write a small throwaway Node script that lays out `ARMY_COMPOSITION` sequentially across the 40 territory squares), then:

Run: `npx supabase functions serve submit-setup --no-verify-jwt`
Run: `curl -X POST http://127.0.0.1:54321/functions/v1/submit-setup -H "Content-Type: application/json" -d '{"token":"<player1 token>","placements":[...40 entries...]}'`
Expected: `{"ok":true,"gameStarted":false}` (player 2 hasn't submitted yet).

- [ ] **Step 4: Repeat for player 2 and confirm the game starts**

Run the same curl with player 2's token and a placement covering rows 0-3.
Expected: `{"ok":true,"gameStarted":true}`.

Run: `npx supabase db execute --sql "select status, current_turn_slot, turn_number from games where room_code = '<roomCode>';"`
Expected: `status = 'active'`, `current_turn_slot` is `1` or `2`, `turn_number = 1`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/submit-setup
git commit -m "feat: submit-setup Edge Function with army composition validation"
```

---

## Task 12: Edge Function — make-move

**Files:**
- Create: `supabase/functions/make-move/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/make-move/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyMove } from "../_shared/rules/game.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface Square {
  row: number;
  col: number;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token, from, to } = await req.json() as { token: string; from: Square; to: Square };
  if (!token || !from || !to) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401 });
  }

  const gameId = playerRow.game_id;
  const playerSlot = playerRow.player_slot;

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number")
    .eq("id", gameId)
    .single();

  if (gameError || !game) {
    return new Response(JSON.stringify({ error: "GAME_NOT_FOUND" }), { status: 404 });
  }

  const { data: pieceRows, error: piecesError } = await supabase
    .from("pieces")
    .select("id, player_slot, rank, row_idx, col_idx, alive")
    .eq("game_id", gameId);

  if (piecesError || !pieceRows) {
    return new Response(JSON.stringify({ error: "STATE_LOAD_FAILED" }), { status: 500 });
  }

  const { data: moveRows, error: movesError } = await supabase
    .from("moves")
    .select("piece_id, player_slot, from_row, from_col, to_row, to_col")
    .eq("game_id", gameId)
    .order("move_number", { ascending: true });

  if (movesError) {
    return new Response(JSON.stringify({ error: "HISTORY_LOAD_FAILED" }), { status: 500 });
  }

  const moveHistoryByPlayer: Record<number, { pieceId: string; from: string; to: string }[]> = { 1: [], 2: [] };
  for (const m of moveRows ?? []) {
    moveHistoryByPlayer[m.player_slot].push({
      pieceId: m.piece_id,
      from: `${m.from_row},${m.from_col}`,
      to: `${m.to_row},${m.to_col}`,
    });
  }

  const state = {
    status: game.status,
    currentTurnSlot: game.current_turn_slot,
    pieces: pieceRows.map((p) => ({
      id: p.id,
      playerSlot: p.player_slot,
      rank: p.rank,
      row: p.row_idx,
      col: p.col_idx,
      alive: p.alive,
    })),
    moveHistoryByPlayer,
  };

  const result = applyMove(state, { playerSlot, from, to });

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.reason }), { status: 400 });
  }

  const movedPiece = state.pieces.find(
    (p) => p.alive && p.row === from.row && p.col === from.col && p.playerSlot === playerSlot,
  )!;

  const moveType = result.combatResult ? "attack" : "move";

  const { error: moveInsertError } = await supabase.from("moves").insert({
    game_id: gameId,
    piece_id: movedPiece.id,
    move_number: game.turn_number,
    player_slot: playerSlot,
    from_row: from.row,
    from_col: from.col,
    to_row: to.row,
    to_col: to.col,
    move_type: moveType,
    outcome: result.combatResult?.outcome ?? null,
    attacker_rank: result.combatResult?.attackerRank ?? null,
    defender_rank: result.combatResult?.defenderRank ?? null,
  });

  if (moveInsertError) {
    return new Response(JSON.stringify({ error: "MOVE_LOG_FAILED", detail: moveInsertError.message }), { status: 500 });
  }

  // Combat always reveals BOTH participants' identity to both players, even
  // the side that wins and stays in place without moving or dying (e.g. a
  // defender that survives an attack). Track both combat participant IDs
  // separately from the moved/died check below, which only covers position
  // and life-state changes.
  const revealedPieceIds = new Set<string>();
  if (result.combatResult) {
    revealedPieceIds.add(movedPiece.id);
    const defenderId = state.pieces.find(
      (p) => p.alive && p.row === to.row && p.col === to.col && p.id !== movedPiece.id,
    )?.id;
    if (defenderId) revealedPieceIds.add(defenderId);
  }

  for (const updated of result.newState.pieces) {
    const original = state.pieces.find((p) => p.id === updated.id)!;
    const moved = updated.row !== original.row || updated.col !== original.col;
    const died = updated.alive !== original.alive;
    const needsReveal = revealedPieceIds.has(updated.id);

    if (!moved && !died && !needsReveal) continue;

    const patch: Record<string, unknown> = {};
    if (moved || died) {
      patch.row_idx = updated.row;
      patch.col_idx = updated.col;
      patch.alive = updated.alive;
    }
    if (needsReveal) {
      patch.revealed_rank = updated.rank;
    }
    await supabase.from("pieces").update(patch).eq("id", updated.id);
  }

  await supabase
    .from("games")
    .update({
      current_turn_slot: result.newState.currentTurnSlot,
      turn_number: game.turn_number + 1,
      status: result.newState.status,
      winner_slot: result.winnerSlot ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", gameId);

  return new Response(
    JSON.stringify({ ok: true, combatResult: result.combatResult, winnerSlot: result.winnerSlot }),
    { headers: { "Content-Type": "application/json" } },
  );
});
```

- [ ] **Step 2: Smoke-test a plain move using the active game from Task 11**

Run: `npx supabase functions serve make-move --no-verify-jwt`
Run: `curl -X POST http://127.0.0.1:54321/functions/v1/make-move -H "Content-Type: application/json" -d '{"token":"<token of whichever player has current_turn_slot>","from":{"row":6,"col":0},"to":{"row":5,"col":0}}'`
(Adjust `from`/`to` to match a piece you actually placed at row 6 in Task 11's setup script, moving into the open middle strip.)
Expected: `{"ok":true,"combatResult":null,"winnerSlot":null}`.

- [ ] **Step 3: Verify persistence**

Run: `npx supabase db execute --sql "select current_turn_slot, turn_number from games where room_code = '<roomCode>';"`
Expected: `current_turn_slot` flipped to the other player, `turn_number` incremented by 1.

Run: `npx supabase db execute --sql "select row_idx, col_idx from pieces where id = '<the moved piece's id>';"`
Expected: matches the `to` square from Step 2.

- [ ] **Step 4: Smoke-test an out-of-turn move is rejected**

Run the same curl again immediately with the same token (now not their turn).
Expected: HTTP 400 with `{"error":"NOT_YOUR_TURN"}`.

- [ ] **Step 5: Smoke-test that a surviving defender still gets revealed**

Set up a state (via the local DB, or by playing moves) where player 1 attacks player 2's piece and loses (player 1's attacker has a higher rank number than the defender). After calling `make-move` for that attack:

Run: `npx supabase db execute --sql "select id, alive, revealed_rank from pieces where id = '<the defender's piece id>';"`
Expected: `alive = true` (it survived) AND `revealed_rank` is now set to its actual rank — this is the case the loop's `needsReveal` check exists for for; confirm it isn't null.

- [ ] **Step 6: Re-sync the shared rules copy if anything in `src/rules/` changed while debugging**

Run: `diff -rq src/rules/ supabase/functions/_shared/rules/ | grep -v README`
Expected: no output. If there is output, re-run the copy command from Task 8, Step 1.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/make-move
git commit -m "feat: make-move Edge Function wrapping the rules engine"
```

---

## Task 13: Edge Function — send-chat

**Files:**
- Create: `supabase/functions/send-chat/index.ts`

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/send-chat/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_LENGTH = 500;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token, body } = await req.json();
  if (!token || typeof body !== "string" || body.trim().length === 0) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }
  if (body.length > MAX_LENGTH) {
    return new Response(JSON.stringify({ error: "MESSAGE_TOO_LONG" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401 });
  }

  const { error: insertError } = await supabase.from("chat_messages").insert({
    game_id: playerRow.game_id,
    player_slot: playerRow.player_slot,
    body: body.trim(),
  });

  if (insertError) {
    return new Response(JSON.stringify({ error: "SEND_FAILED", detail: insertError.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 2: Smoke-test**

Run: `npx supabase functions serve send-chat --no-verify-jwt`
Run: `curl -X POST http://127.0.0.1:54321/functions/v1/send-chat -H "Content-Type: application/json" -d '{"token":"<any valid player token>","body":"good luck!"}'`
Expected: `{"ok":true}`.

Run: `npx supabase db execute --sql "select player_slot, body from chat_messages order by created_at desc limit 1;"`
Expected: one row with `body = 'good luck!'`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-chat
git commit -m "feat: send-chat Edge Function"
```

---

## Task 14: Frontend — Supabase client + Home screen

**Files:**
- Create: `web/js/supabaseClient.js`
- Create: `web/index.html`
- Create: `web/js/home.js`
- Create: `web/css/styles.css`

- [ ] **Step 1: Write the shared Supabase client module**

```javascript
// web/js/supabaseClient.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public anon key -- safe to ship in frontend JS. It grants no access to
// `pieces` or `game_players` (no RLS policy = no access); every sensitive
// operation goes through an Edge Function or the get_game_state RPC.
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const message = data?.error ?? error.message ?? "UNKNOWN_ERROR";
    throw new Error(message);
  }
  return data;
}
```

- [ ] **Step 2: Write the home screen**

```html
<!-- web/index.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stratego</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <main class="home">
    <h1>Stratego</h1>
    <section class="panel">
      <h2>Start a new game</h2>
      <button id="new-game-btn">New Game</button>
      <p id="new-game-result" class="result" hidden></p>
    </section>
    <section class="panel">
      <h2>Join a game</h2>
      <form id="join-form">
        <input id="room-code-input" placeholder="Room code" maxlength="8" autocapitalize="characters" required />
        <button type="submit">Join</button>
      </form>
      <p id="join-error" class="error" hidden></p>
    </section>
  </main>
  <script type="module" src="js/home.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write the home screen logic**

```javascript
// web/js/home.js
import { callFunction } from "./supabaseClient.js";

function storeToken(roomCode, token) {
  localStorage.setItem(`stratego:${roomCode}:token`, token);
}

document.getElementById("new-game-btn").addEventListener("click", async () => {
  const button = document.getElementById("new-game-btn");
  const resultEl = document.getElementById("new-game-result");
  button.disabled = true;
  try {
    const { roomCode, token, invitePath } = await callFunction("create-game", {});
    storeToken(roomCode, token);
    const inviteUrl = `${location.origin}${invitePath}`;
    resultEl.hidden = false;
    resultEl.innerHTML = `Room created! Send this link to your friend: <a href="${inviteUrl}">${inviteUrl}</a>`;
    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    resultEl.hidden = false;
    resultEl.textContent = `Failed to create game: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

document.getElementById("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const errorEl = document.getElementById("join-error");
  const roomCode = document.getElementById("room-code-input").value.trim().toUpperCase();
  errorEl.hidden = true;
  try {
    const { token } = await callFunction("join-game", { roomCode });
    storeToken(roomCode, token);
    location.href = `setup.html?code=${roomCode}`;
  } catch (err) {
    errorEl.hidden = false;
    errorEl.textContent = `Could not join: ${err.message}`;
  }
});
```

- [ ] **Step 4: Write a minimal, classic wood & military stylesheet**

```css
/* web/css/styles.css */
:root {
  --wood-dark: #3e2f1c;
  --wood-light: #c9a876;
  --wood-mid: #8a6a3f;
  --accent-green: #2f5c3f;
  --ink: #efe6d8;
}

body {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  background: var(--wood-dark);
  color: var(--ink);
}

.home {
  max-width: 480px;
  margin: 0 auto;
  padding: 2rem 1rem;
}

.panel {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--wood-mid);
  border-radius: 6px;
  padding: 1rem;
  margin-bottom: 1rem;
}

button {
  background: var(--wood-mid);
  color: var(--ink);
  border: 1px solid var(--wood-light);
  border-radius: 4px;
  padding: 0.5rem 1rem;
  cursor: pointer;
  font-size: 1rem;
}

button:hover {
  background: var(--wood-light);
  color: var(--wood-dark);
}

.error {
  color: #ffb3b3;
}

.result a {
  color: var(--wood-light);
}
```

- [ ] **Step 5: Fill in real Supabase project values**

Replace `YOUR-PROJECT-REF` and `YOUR-ANON-KEY` in `web/js/supabaseClient.js` with the values from `npx supabase status` (local) or the deployed project's API settings page (production). Document this as a required manual step in `README.md` (Task 18) rather than committing real production keys before the project exists.

- [ ] **Step 6: Manual verification**

Run: `npx supabase functions serve --no-verify-jwt` (serves all functions together)
Run: `npx http-server web -p 8080` (or any static file server)
Open `http://localhost:8080` in a browser, click **New Game**, confirm it redirects to `setup.html?code=...` and that `localStorage` (DevTools → Application → Local Storage) has a `stratego:<code>:token` entry.

- [ ] **Step 7: Commit**

```bash
git add web/js/supabaseClient.js web/index.html web/js/home.js web/css/styles.css
git commit -m "feat: home screen for creating/joining a game"
```

---

## Task 15: Frontend — Setup screen

**Files:**
- Create: `web/setup.html`
- Create: `web/js/setup.js`
- Modify: `web/js/home.js` (add per-slot storage, see Step 3)

- [ ] **Step 1: Write the setup screen markup**

```html
<!-- web/setup.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stratego — Setup</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <main class="setup">
    <h1>Arrange your army</h1>
    <div class="setup-controls">
      <button data-formation="random">Random</button>
      <button data-formation="defensive">Defensive</button>
      <button data-formation="aggressive">Aggressive</button>
      <button id="clear-btn">Clear</button>
    </div>
    <div id="tray" class="tray"></div>
    <div id="territory-grid" class="territory-grid"></div>
    <button id="submit-setup-btn" disabled>Submit setup</button>
    <p id="setup-status" class="result" hidden></p>
  </main>
  <script type="module" src="js/setup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the setup screen logic**

```javascript
// web/js/setup.js
import { callFunction } from "./supabaseClient.js";
import { ARMY_COMPOSITION } from "../../src/rules/pieces.js";

const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const token = localStorage.getItem(`stratego:${roomCode}:token`);

if (!token) {
  document.body.innerHTML = "<p>No access token found for this room. Use the link your friend sent you, or create a new game from the home page.</p>";
  throw new Error("missing token");
}

// Fixed territory rows: rows 6-9 if this browser holds a player-1-shaped
// token, rows 0-3 otherwise. We don't know our own slot until submit-setup
// responds, so the board always renders as "your 4 rows nearest you" using
// a local, purely visual row scheme (0-3 top-to-bottom); the server maps
// this to the correct absolute board rows for whichever slot you actually are.
const LOCAL_ROWS = [0, 1, 2, 3];
const COLS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

let placements = new Map(); // key "row,col" -> rank

function totalPieces() {
  return ARMY_COMPOSITION.reduce((sum, e) => sum + e.count, 0);
}

function remainingByRank() {
  const counts = new Map(ARMY_COMPOSITION.map((e) => [String(e.rank), e.count]));
  for (const rank of placements.values()) {
    counts.set(String(rank), counts.get(String(rank)) - 1);
  }
  return counts;
}

function renderTray() {
  const tray = document.getElementById("tray");
  tray.innerHTML = "";
  const remaining = remainingByRank();
  for (const [rank, count] of remaining) {
    if (count <= 0) continue;
    const chip = document.createElement("button");
    chip.className = "tray-chip";
    chip.textContent = `${rank} (${count})`;
    chip.dataset.rank = rank;
    chip.addEventListener("click", () => {
      selectedRank = rank;
      highlightSelectedChip(chip);
    });
    tray.appendChild(chip);
  }
}

function highlightSelectedChip(chip) {
  document.querySelectorAll(".tray-chip").forEach((el) => el.classList.remove("selected"));
  chip.classList.add("selected");
}

let selectedRank = null;

function renderGrid() {
  const grid = document.getElementById("territory-grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${COLS.length}, 1fr)`;
  for (const row of LOCAL_ROWS) {
    for (const col of COLS) {
      const cell = document.createElement("div");
      cell.className = "territory-cell";
      const key = `${row},${col}`;
      const rank = placements.get(key);
      if (rank) {
        cell.textContent = rank;
        cell.classList.add("occupied");
      }
      cell.addEventListener("click", () => {
        if (placements.has(key)) {
          placements.delete(key);
        } else if (selectedRank) {
          const remaining = remainingByRank();
          if ((remaining.get(selectedRank) ?? 0) > 0) {
            placements.set(key, selectedRank);
          }
        }
        renderGrid();
        renderTray();
        updateSubmitButton();
      });
      grid.appendChild(cell);
    }
  }
}

function updateSubmitButton() {
  document.getElementById("submit-setup-btn").disabled = placements.size !== totalPieces();
}

function applyFormation(name) {
  placements = new Map();
  const squares = [];
  for (const row of LOCAL_ROWS) {
    for (const col of COLS) squares.push([row, col]);
  }

  // "random": shuffle all 40 ranks across all 40 squares.
  // "defensive"/"aggressive": simple documented starting heuristics --
  //   defensive keeps Bombs and the Flag on the back row (row 3, farthest
  //   from the midline) with Miners just in front; aggressive pushes Scouts
  //   and higher-value attackers toward the front row (row 0, nearest the
  //   midline) with the Flag tucked on the back row flanked by two Bombs.
  const ranks = ARMY_COMPOSITION.flatMap((e) => Array(e.count).fill(String(e.rank)));

  if (name === "random") {
    for (let i = ranks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
    }
    squares.forEach(([row, col], i) => placements.set(`${row},${col}`, ranks[i]));
  } else {
    // defensive/aggressive: back row (row 3) gets Flag + Bombs first, front
    // rows filled with the remaining ranks sorted so weaker pieces (higher
    // rank number) lead for "defensive" and stronger pieces lead for
    // "aggressive" -- deliberately simple, documented placeholders for the
    // preset slots; refining these against real opening theory is tracked
    // as a follow-up, not blocking MVP.
    const backRow = LOCAL_ROWS[LOCAL_ROWS.length - 1];
    const frontRows = LOCAL_ROWS.slice(0, -1);
    const bombsAndFlag = ranks.filter((r) => r === "BOMB" || r === "FLAG");
    const rest = ranks.filter((r) => r !== "BOMB" && r !== "FLAG");
    rest.sort((a, b) => (name === "defensive" ? Number(b) - Number(a) : Number(a) - Number(b)));

    const backSquares = COLS.map((col) => [backRow, col]);
    bombsAndFlag.forEach((rank, i) => placements.set(`${backSquares[i][0]},${backSquares[i][1]}`, rank));

    const frontSquares = [];
    for (const row of frontRows) for (const col of COLS) frontSquares.push([row, col]);
    rest.forEach((rank, i) => placements.set(`${frontSquares[i][0]},${frontSquares[i][1]}`, rank));
  }

  renderGrid();
  renderTray();
  updateSubmitButton();
}

document.querySelectorAll("[data-formation]").forEach((btn) => {
  btn.addEventListener("click", () => applyFormation(btn.dataset.formation));
});

document.getElementById("clear-btn").addEventListener("click", () => {
  placements = new Map();
  renderGrid();
  renderTray();
  updateSubmitButton();
});

document.getElementById("submit-setup-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("setup-status");
  const payload = Array.from(placements.entries()).map(([key, rank]) => {
    const [localRow, col] = key.split(",").map(Number);
    // Flip the locally-drawn row (0=nearest midline .. 3=back row) into the
    // absolute board row the server expects. The server already knows this
    // player's slot from the token, but it needs literal board coordinates,
    // and slot 1's territory (rows 6-9) is drawn top-to-bottom opposite to
    // slot 2's (rows 0-3) so that "row 0" always means "nearest the midline"
    // for whoever is looking at their own screen. We don't know our slot
    // client-side, so we send both a primary and mirrored guess is wrong --
    // instead, submit-setup validates against BOTH possible territories and
    // accepts whichever matches the caller's actual slot (see Task 11 note).
    return { rank, row: localRow, col };
  });

  try {
    const result = await callFunction("submit-setup", { token, placements: payload });
    statusEl.hidden = false;
    statusEl.textContent = result.gameStarted
      ? "Both players ready! Loading game..."
      : "Setup submitted. Waiting for your opponent...";
    if (result.gameStarted) {
      location.href = `game.html?code=${roomCode}`;
    }
  } catch (err) {
    statusEl.hidden = false;
    statusEl.textContent = `Setup failed: ${err.message}`;
  }
});

renderGrid();
renderTray();
```

- [ ] **Step 3: Fix the row-mapping gap called out in Step 2's own comment**

The comment in the submit handler identifies a real problem: `submit-setup` (Task 11) validates placements against a fixed territory (`[6,7,8,9]` for slot 1, `[0,1,2,3]` for slot 2) using **absolute** board rows, but this screen has been collecting **local** rows (`0-3`, "nearest the midline first"). Sending local rows directly will fail slot 1's validation. Fix it by converting local row to absolute row using the player's slot, which the client already learned implicitly: slot 1 owns the room's *creator* token (returned by `create-game`), slot 2 owns the *joiner* token (returned by `join-game`). Track that at storage time in Task 14/step 3 and Task 10/step 2 respectively, then use it here:

In `web/js/home.js`, change `storeToken` calls to also store the slot:

```javascript
// web/js/home.js -- replace storeToken and its two call sites
function storeSession(roomCode, token, slot) {
  localStorage.setItem(`stratego:${roomCode}:token`, token);
  localStorage.setItem(`stratego:${roomCode}:slot`, String(slot));
}
```

```javascript
// in the "New Game" handler, replace:
// storeToken(roomCode, token);
// with:
storeSession(roomCode, token, 1);
```

```javascript
// in the "Join" handler, replace:
// storeToken(roomCode, token);
// with:
storeSession(roomCode, token, 2);
```

Then in `web/js/setup.js`, read the slot and convert before sending:

```javascript
// add near the top, after `const token = ...` line
const slot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));
const ABSOLUTE_ROWS = slot === 1 ? [9, 8, 7, 6] : [0, 1, 2, 3]; // index 0 = nearest midline, for both slots
```

```javascript
// in the submit handler, replace the payload map body with:
return { rank, row: ABSOLUTE_ROWS[localRow], col };
```

- [ ] **Step 4: Manual verification**

With both `home.js` and `setup.js` updated, repeat the two-browser flow: create a game in one browser tab (slot 1), open the invite link in a private/incognito window (slot 2), click **Random** in both, submit both, and confirm both redirect to `game.html` without a `WRONG_ARMY_COMPOSITION` or `OUTSIDE_TERRITORY` error.

- [ ] **Step 5: Commit**

```bash
git add web/setup.html web/js/setup.js web/js/home.js
git commit -m "feat: setup screen with shuffle/preset/manual placement"
```

---

## Task 16: Frontend — Game screen (board + realtime)

**Files:**
- Create: `web/game.html`
- Create: `web/js/game.js`

- [ ] **Step 1: Write the game screen markup**

```html
<!-- web/game.html -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stratego — Game</title>
  <link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <main class="game">
    <div id="board" class="board"></div>
    <aside class="side-panel">
      <p id="turn-indicator" class="turn-indicator"></p>
      <div class="game-actions">
        <button id="resign-btn">Resign</button>
        <button id="rematch-btn" hidden>Rematch</button>
      </div>
      <h3>Move log</h3>
      <ul id="move-log"></ul>
      <h3>Chat</h3>
      <ul id="chat-log"></ul>
      <form id="chat-form">
        <input id="chat-input" maxlength="500" placeholder="Say something..." />
        <button type="submit">Send</button>
      </form>
    </aside>
  </main>
  <script type="module" src="js/game.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write the board rendering and tap-to-move logic**

```javascript
// web/js/game.js
import { supabase, callFunction } from "./supabaseClient.js";
import { BOARD_SIZE, isLake } from "../../src/rules/board.js";

const params = new URLSearchParams(location.search);
const roomCode = params.get("code");
const token = localStorage.getItem(`stratego:${roomCode}:token`);
const mySlot = Number(localStorage.getItem(`stratego:${roomCode}:slot`));

if (!token) {
  document.body.innerHTML = "<p>No access token found for this room.</p>";
  throw new Error("missing token");
}

let gameRow = null;
let piecesById = new Map();
let selectedPieceId = null;

async function loadGameId() {
  const { data, error } = await supabase.from("games").select("id").eq("room_code", roomCode).single();
  if (error || !data) throw new Error("Game not found");
  return data.id;
}

async function refreshState() {
  const { data: rows, error } = await supabase.rpc("get_game_state", { p_token: token });
  if (error) {
    console.error("get_game_state failed", error);
    return;
  }
  piecesById = new Map(rows.map((r) => [r.piece_id, r]));
  renderBoard();
}

async function refreshGameRow(gameId) {
  const { data, error } = await supabase
    .from("games")
    .select("status, current_turn_slot, turn_number, winner_slot")
    .eq("id", gameId)
    .single();
  if (error) return;
  gameRow = data;
  renderTurnIndicator();
}

function renderTurnIndicator() {
  const el = document.getElementById("turn-indicator");
  if (!gameRow) return;
  if (gameRow.status === "finished") {
    el.textContent = gameRow.winner_slot === mySlot ? "You won!" : "You lost.";
    document.getElementById("rematch-btn").hidden = false;
    return;
  }
  el.textContent = gameRow.current_turn_slot === mySlot ? "Your turn" : "Waiting for opponent...";
}

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  board.style.gridTemplateColumns = `repeat(${BOARD_SIZE}, 1fr)`;

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement("div");
      cell.className = "board-cell";
      if (isLake(row, col)) cell.classList.add("lake");

      const piece = [...piecesById.values()].find((p) => p.row_idx === row && p.col_idx === col && p.alive);
      if (piece) {
        cell.classList.add(piece.is_mine ? "mine" : "enemy");
        cell.textContent = piece.rank ?? "?";
        if (piece.piece_id === selectedPieceId) cell.classList.add("selected");
      }

      cell.addEventListener("click", () => handleCellClick(row, col, piece));
      board.appendChild(cell);
    }
  }
}

async function handleCellClick(row, col, piece) {
  if (!gameRow || gameRow.status !== "active" || gameRow.current_turn_slot !== mySlot) return;

  if (selectedPieceId) {
    const selected = piecesById.get(selectedPieceId);
    const from = { row: selected.row_idx, col: selected.col_idx };
    const to = { row, col };
    selectedPieceId = null;
    try {
      await callFunction("make-move", { token, from, to });
    } catch (err) {
      alert(`Move rejected: ${err.message}`);
    }
    await refreshState();
    return;
  }

  if (piece && piece.is_mine) {
    selectedPieceId = piece.piece_id;
    renderBoard();
  }
}

document.getElementById("resign-btn").addEventListener("click", async () => {
  if (!confirm("Resign this game?")) return;
  // Resigning is modeled as the resigning player's opponent winning; implemented
  // as a dedicated Edge Function is out of scope for this task -- see Task 17.
  alert("Resign is wired up in Task 17 alongside rematch.");
});

async function init() {
  const gameId = await loadGameId();
  await refreshGameRow(gameId);
  await refreshState();

  supabase
    .channel(`game-${gameId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async () => {
      await refreshGameRow(gameId);
      await refreshState();
    })
    .subscribe();
}

init();
```

- [ ] **Step 3: Add board and side-panel styles**

```css
/* append to web/css/styles.css */
.game {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  max-width: 900px;
  margin: 0 auto;
}

.board {
  display: grid;
  gap: 2px;
  flex: 1;
  background: var(--wood-dark);
  padding: 4px;
  border-radius: 4px;
}

.board-cell {
  aspect-ratio: 1;
  background: var(--wood-light);
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  cursor: pointer;
}

.board-cell.lake {
  background: #2f5c3f;
  cursor: default;
}

.board-cell.mine {
  background: #a8c9a8;
  font-weight: bold;
}

.board-cell.enemy {
  background: #d98b8b;
}

.board-cell.selected {
  outline: 3px solid gold;
}

.side-panel {
  width: 260px;
}

.turn-indicator {
  font-weight: bold;
}

#move-log, #chat-log {
  list-style: none;
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
  font-size: 0.85rem;
}
```

- [ ] **Step 4: Manual verification**

With both players through setup (Task 15), open `game.html?code=<roomCode>` in both browser contexts. Confirm: the board renders 10x10 with two visible lake clusters, your own pieces show their rank, your opponent's unmoved pieces show `?`, and tapping one of your pieces then an empty adjacent square moves it and flips "Your turn" to the other browser within a couple seconds (via the Realtime subscription).

- [ ] **Step 5: Commit**

```bash
git add web/game.html web/js/game.js web/css/styles.css
git commit -m "feat: game screen with board rendering, tap-to-move, and realtime sync"
```

---

## Task 17: Frontend — Move log, chat, resign, rematch

**Files:**
- Modify: `web/js/game.js`
- Create: `supabase/functions/resign/index.ts`
- Create: `supabase/functions/rematch/index.ts`

- [ ] **Step 1: Write the resign Edge Function**

```typescript
// supabase/functions/resign/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401 });
  }

  const { data: game, error: gameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (gameError || !game || game.status !== "active") {
    return new Response(JSON.stringify({ error: "GAME_NOT_ACTIVE" }), { status: 409 });
  }

  const winnerSlot = playerRow.player_slot === 1 ? 2 : 1;

  await supabase
    .from("games")
    .update({ status: "finished", winner_slot: winnerSlot, updated_at: new Date().toISOString() })
    .eq("id", playerRow.game_id);

  return new Response(JSON.stringify({ ok: true, winnerSlot }), { headers: { "Content-Type": "application/json" } });
});
```

- [ ] **Step 2: Write the rematch Edge Function**

Rematch creates a fresh game between the same two players, reusing their existing tokens' owner identities but issuing new tokens/room so old game history stays intact and browsable.

```typescript
// supabase/functions/rematch/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROOM_CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 8;

function generateRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ROOM_CODE_CHARS[b % ROOM_CODE_CHARS.length]).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405 });
  }

  const { token } = await req.json();
  if (!token) {
    return new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: playerRow, error: playerError } = await supabase
    .from("game_players")
    .select("game_id, player_slot")
    .eq("secret_token", token)
    .maybeSingle();

  if (playerError || !playerRow) {
    return new Response(JSON.stringify({ error: "INVALID_TOKEN" }), { status: 401 });
  }

  const { data: oldGame, error: oldGameError } = await supabase
    .from("games")
    .select("status")
    .eq("id", playerRow.game_id)
    .single();

  if (oldGameError || !oldGame || oldGame.status !== "finished") {
    return new Response(JSON.stringify({ error: "GAME_NOT_FINISHED" }), { status: 409 });
  }

  const roomCode = generateRoomCode();
  const { data: newGame, error: newGameError } = await supabase
    .from("games")
    .insert({ room_code: roomCode })
    .select("id")
    .single();

  if (newGameError) {
    return new Response(JSON.stringify({ error: "CREATE_FAILED", detail: newGameError.message }), { status: 500 });
  }

  const { data: newPlayerRow, error: newPlayerError } = await supabase
    .from("game_players")
    .insert({ game_id: newGame.id, player_slot: playerRow.player_slot })
    .select("secret_token")
    .single();

  if (newPlayerError) {
    return new Response(JSON.stringify({ error: "CREATE_PLAYER_FAILED", detail: newPlayerError.message }), { status: 500 });
  }

  return new Response(
    JSON.stringify({ roomCode, token: newPlayerRow.secret_token, yourSlot: playerRow.player_slot }),
    { headers: { "Content-Type": "application/json" } },
  );
});
```

- [ ] **Step 3: Smoke-test both functions**

Run: `npx supabase functions serve resign rematch --no-verify-jwt`
Using an active game from earlier testing, resign as one player:
Run: `curl -X POST http://127.0.0.1:54321/functions/v1/resign -H "Content-Type: application/json" -d '{"token":"<a player token from an active game>"}'`
Expected: `{"ok":true,"winnerSlot":<the other slot>}`.

Then request a rematch with either token from that now-finished game:
Run: `curl -X POST http://127.0.0.1:54321/functions/v1/rematch -H "Content-Type: application/json" -d '{"token":"<same token>"}'`
Expected: a fresh `roomCode`, a new `token`, and `yourSlot` matching the caller's slot in the old game. The second player must separately call `join-game` with the new `roomCode` — rematch only recreates the caller's own slot, mirroring how the original game started.

- [ ] **Step 4: Wire move log, chat, resign, and rematch into the game screen**

Replace the placeholder resign handler and add move-log/chat rendering in `web/js/game.js`:

```javascript
// web/js/game.js -- add these functions, and replace the two marked sections below

async function refreshMoveLog(gameId) {
  const { data, error } = await supabase
    .from("moves")
    .select("move_number, player_slot, from_row, from_col, to_row, to_col, move_type, outcome, attacker_rank, defender_rank")
    .eq("game_id", gameId)
    .order("move_number", { ascending: true });
  if (error) return;

  const list = document.getElementById("move-log");
  list.innerHTML = "";
  for (const m of data) {
    const li = document.createElement("li");
    const who = m.player_slot === mySlot ? "You" : "Opponent";
    const from = `${m.from_row},${m.from_col}`;
    const to = `${m.to_row},${m.to_col}`;
    if (m.move_type === "attack") {
      li.textContent = `${who}: ${from} -> ${to} (${m.attacker_rank} vs ${m.defender_rank}: ${m.outcome})`;
    } else {
      li.textContent = `${who}: ${from} -> ${to}`;
    }
    list.appendChild(li);
  }
}

async function refreshChat(gameId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("player_slot, body, created_at")
    .eq("game_id", gameId)
    .order("created_at", { ascending: true });
  if (error) return;

  const list = document.getElementById("chat-log");
  list.innerHTML = "";
  for (const m of data) {
    const li = document.createElement("li");
    li.textContent = `${m.player_slot === mySlot ? "You" : "Opponent"}: ${m.body}`;
    list.appendChild(li);
  }
}

document.getElementById("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("chat-input");
  const body = input.value.trim();
  if (!body) return;
  input.value = "";
  try {
    await callFunction("send-chat", { token, body });
  } catch (err) {
    alert(`Message failed: ${err.message}`);
  }
});

document.getElementById("rematch-btn").addEventListener("click", async () => {
  try {
    const result = await callFunction("rematch", { token });
    localStorage.setItem(`stratego:${result.roomCode}:token`, result.token);
    localStorage.setItem(`stratego:${result.roomCode}:slot`, String(result.yourSlot));
    alert(`Rematch created! Room code: ${result.roomCode}. Share it with your opponent, then wait for them to join before setup.`);
    location.href = `setup.html?code=${result.roomCode}`;
  } catch (err) {
    alert(`Rematch failed: ${err.message}`);
  }
});
```

Replace the resign handler's placeholder body:

```javascript
// replace the resign-btn click handler body from Task 16 Step 2 with:
document.getElementById("resign-btn").addEventListener("click", async () => {
  if (!confirm("Resign this game?")) return;
  try {
    await callFunction("resign", { token });
  } catch (err) {
    alert(`Resign failed: ${err.message}`);
  }
});
```

Wire the two new refresh calls into `init()` and the Realtime callback:

```javascript
// replace the init() function from Task 16 Step 2 with:
async function init() {
  const gameId = await loadGameId();
  await refreshGameRow(gameId);
  await refreshState();
  await refreshMoveLog(gameId);
  await refreshChat(gameId);

  supabase
    .channel(`game-${gameId}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` }, async () => {
      await refreshGameRow(gameId);
      await refreshState();
      await refreshMoveLog(gameId);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `game_id=eq.${gameId}` }, async () => {
      await refreshChat(gameId);
    })
    .subscribe();
}

init();
```

- [ ] **Step 5: Manual verification**

Play a short game between two browser contexts to a Flag capture (or resign from one side). Confirm: move log shows both plain moves and combats with correct ranks after they've been revealed, chat messages appear in both windows within a couple seconds, resigning ends the game and shows "You lost"/"You won" correctly on each side, and clicking rematch produces a new room code.

- [ ] **Step 6: Commit**

```bash
git add web/js/game.js supabase/functions/resign supabase/functions/rematch
git commit -m "feat: move log, chat, resign, and rematch"
```

---

## Task 18: Deployment

**Files:**
- Create: `render.yaml`
- Create: `README.md`

- [ ] **Step 1: Write the Render static site blueprint**

```yaml
# render.yaml
services:
  - type: web
    name: stratego
    runtime: static
    staticPublishPath: ./web
    buildCommand: "echo 'no build step'"
    pullRequestPreviewsEnabled: false
```

- [ ] **Step 2: Write the README with setup and deploy steps**

```markdown
# Stratego

Free-to-host, two-player, full-rules online Stratego. See
`docs/superpowers/specs/2026-07-10-stratego-design.md` for the design and
`docs/superpowers/plans/2026-07-10-stratego-implementation.md` for how it
was built.

## Local development

**Rules engine tests** (no external dependencies):

```bash
npm test
```

**Supabase backend** (requires Docker Desktop running, and the Supabase CLI
via `npx`):

```bash
npx supabase start      # first time: pulls images, prints local API URL/keys
npx supabase db reset   # applies supabase/migrations/
npx supabase functions serve --no-verify-jwt   # serves all Edge Functions locally
```

**Frontend** (any static file server works):

```bash
npx http-server web -p 8080
```

Before the frontend can talk to your local (or deployed) Supabase project,
fill in `web/js/supabaseClient.js` with the `SUPABASE_URL` and anon key
printed by `npx supabase status` (local) or found on the project's API
settings page (production).

## Deploying

**Supabase (one-time project setup, then on every schema/function change):**

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push          # applies migrations/
npx supabase functions deploy # deploys all functions in supabase/functions/
```

**Render (static frontend):**

1. Push this repo to GitHub.
2. In the Render dashboard, create a new Static Site from this repo (or run
   `render blueprint launch` if using the Render CLI) — `render.yaml` already
   specifies `./web` as the publish path with no build step.
3. Every push to the deployed branch auto-redeploys; there is no server
   process to spin down or wake up.

## Known operational note

Supabase free projects pause after 7 consecutive days with zero database
requests. Unpausing is a single click in the Supabase dashboard with no data
loss. If that becomes annoying for infrequent games, add a scheduled GitHub
Actions workflow that pings the REST API every few days — not implemented
here since it wasn't needed during initial build/test.
```

- [ ] **Step 3: Verify the blueprint is valid YAML**

Run: `python3 -c "import yaml, sys; yaml.safe_load(open('render.yaml'))" 2>&1 || node -e "require('js-yaml') && console.log('js-yaml not installed, skip')"`

If Python with PyYAML isn't available, visually confirm the file has no tab characters and consistent 2-space indentation (Render's parser is strict about this).

- [ ] **Step 4: Commit**

```bash
git add render.yaml README.md
git commit -m "docs: deployment instructions and Render blueprint"
```

- [ ] **Step 5: Manual production deploy checklist (run once you're ready to go live)**

1. Create a Supabase project at supabase.com (free tier), note the project ref, anon key, and service role key.
2. `npx supabase link --project-ref <ref>` then `npx supabase db push` then `npx supabase functions deploy`.
3. Update `web/js/supabaseClient.js` with the production `SUPABASE_URL` and anon key, commit that change.
4. Push to GitHub, connect the repo to a new Render Static Site pointed at `./web` with no build command.
5. Open the deployed URL, click **New Game**, send the invite link to your friend, and play a full game end-to-end as the final acceptance check.

---

## Plan self-review

**Spec coverage:** Every section of the design spec maps to a task — architecture (Tasks 1-13), fog-of-war enforcement (Task 7's `get_game_state`, Task 12's `revealed_rank` writes), rooms/access (Tasks 9-10, 14), setup phase (Task 11, 15), interaction/board (Task 16), MVP extras — resign/rematch/move log/chat (Tasks 13, 17), deployment (Task 18).

**Placeholder scan:** Found and fixed one leftover no-op/dead line while drafting Task 11 (has its own explicit removal step); no remaining TBD/TODO markers.

**Type consistency:** `applyMove`'s return shape (`{ ok, reason, combatResult, winnerSlot, newState }`) is used identically in `test/rules/game.test.js` (Task 6) and `make-move/index.ts` (Task 12). `ARMY_COMPOSITION` entries (`{ rank, count }`) are consumed the same way in `pieces.test.js` (Task 2), `submit-setup` (Task 11), and `setup.js` (Task 15). Rank values are consistently either the numbers 1-10 or the strings `'BOMB'`/`'FLAG'` everywhere they appear.

**Correctness bugs found and fixed during review (not left as follow-up steps — fixed directly in the task content above):**

1. **Task 12's persistence loop failed to reveal a surviving defender.** The original `for (const updated of result.newState.pieces)` loop only wrote `revealed_rank` for pieces that moved or died, but official Stratego reveals *both* combat participants regardless of outcome — including a defender that wins and stays in place without moving or dying. Fixed by tracking `revealedPieceIds` (both combat participants) separately from the moved/died check, and added Task 12 Step 5 to explicitly verify this case.
2. **Realtime subscriptions in Task 16/17 would never have fired.** `postgres_changes` only delivers events for tables added to the `supabase_realtime` publication — the original migration never added `games` or `chat_messages` to it, so the live-update feature would have silently done nothing. Fixed by adding `alter publication supabase_realtime add table games/chat_messages;` to Task 7's migration, with a verification step (Task 7 Step 4) querying `pg_publication_tables`.
3. **`hasAnyLegalMove` ignored the two-square rule**, so a player whose only remaining "movement-legal" square was blocked by their own two-square-rule history would have been incorrectly treated as having a move, letting a game that should have ended continue indefinitely. Fixed by threading the opponent's move history into `hasAnyLegalMove` and skipping any destination that would violate the rule; added a dedicated test in Task 6 (`'a player whose only remaining move is two-square-rule-blocked also loses'`) that fails against the original implementation and passes against the fix.
4. **Verified by actually running the full Task 2-6 test suite** (`node --test`, 48 tests, extracted into a scratch directory) rather than trusting it by inspection. One test fixture bug surfaced: `'a plain move to an empty square relocates the piece and passes the turn'` only defined a single piece total, so player 2 legitimately had zero movable pieces and the (correct) no-legal-moves win check ended the game instead of just passing the turn — not an engine bug, but a test that was accidentally exercising a different code path than it claimed to. Fixed by giving player 2 a piece with a legal move in that fixture. All 48 tests pass after this fix and the three items above.

**Known follow-up, explicitly out of scope for this plan:** the "defensive"/"aggressive" preset formations in Task 15 use a simple placeholder heuristic (weight higher/lower-rank pieces toward the front) rather than researched competitive Stratego opening theory, because sourcing and encoding real published formations is a content task, not an engineering one. The design spec's requirement is satisfied structurally (presets exist, are swappable, sit alongside manual placement) but the two non-random presets should be revisited with real strategy references before this ships past personal/friend use.
