import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOwnFlag, estimateUnknownEnemyRank, assessGuardSquares } from '../../web/js/flagDefense.js';
import { RANK } from '../../web/js/rules/pieces.js';

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

test('estimateUnknownEnemyRank returns the full-army weighted average when no ranks are revealed', () => {
  const result = estimateUnknownEnemyRank([], [], 2);
  // Mobile army (excluding Bomb/Flag): 1×1 + 1×2 + 2×3 + 3×4 + 4×5 + 4×6 + 4×7 + 5×8 + 8×9 + 1×10 = 215
  // Total mobile pieces: 1+1+2+3+4+4+4+5+8+1 = 33
  // Average: 215/33 ≈ 6.515...
  assert.ok(Math.abs(result - 215 / 33) < 0.001);
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
  // Marshal (rank 1, count 1) is now accounted for. Remaining pool: 32 pieces, sum = 214.
  assert.ok(Math.abs(result - 214 / 32) < 0.001);
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
  // One Scout (rank 9) accounted for. Remaining: 32 pieces, sum = 215-9 = 206.
  assert.ok(Math.abs(result - 206 / 32) < 0.001);
});

test('estimateUnknownEnemyRank falls back to the single remaining rank when pool has one rank left', () => {
  // Simulate all mobile ranks fully revealed except Scouts (8 of them).
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
  assert.equal(result.length, 2);
});

test('assessGuardSquares skips lake neighbors', () => {
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
