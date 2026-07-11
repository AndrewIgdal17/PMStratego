import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBotFormationPlacements, chooseBotMove } from '../../web/js/bot.js';
import { ARMY_COMPOSITION, ARMY_SIZE } from '../../web/js/rules/pieces.js';

test('pickBotFormationPlacements returns a full, valid army with no duplicate squares', () => {
  const placements = pickBotFormationPlacements();
  assert.equal(placements.length, ARMY_SIZE);

  const seen = new Set();
  const countByRank = new Map();
  for (const p of placements) {
    const key = `${p.row},${p.col}`;
    assert.equal(seen.has(key), false, `duplicate square ${key}`);
    seen.add(key);
    assert.ok(p.row >= 0 && p.row <= 3, `row ${p.row} outside slot-2 territory`);
    assert.ok(p.col >= 0 && p.col <= 9, `col ${p.col} out of bounds`);
    countByRank.set(String(p.rank), (countByRank.get(String(p.rank)) ?? 0) + 1);
  }
  for (const entry of ARMY_COMPOSITION) {
    assert.equal(countByRank.get(String(entry.rank)), entry.count, `wrong count for rank ${entry.rank}`);
  }
});

// Deviation: plan placed the enemy at (5,6), which is a lake square.
// Moved the engagement to (5,4)/(5,5) so the capture is a real legal move.
test('chooseBotMove prefers a winning capture over other legal moves', () => {
  const rows = [
    { piece_id: 'colonel-1', player_slot: 2, rank: '3', row_idx: 5, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'major-enemy', player_slot: 1, rank: '4', row_idx: 5, col_idx: 4, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, []);
  assert.deepEqual(move, { pieceId: 'colonel-1', from: { row: 5, col: 5 }, to: { row: 5, col: 4 } });
});

// Deviation: plan placed the enemy at (5,6), a lake. Moved the blocked
// sergeant engagement to row 3 so all four orthogonal neighbors are dry land.
test('chooseBotMove avoids a losing capture when a safe alternative exists', () => {
  const rows = [
    { piece_id: 'sergeant-1', player_slot: 2, rank: '7', row_idx: 3, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-1', player_slot: 2, rank: 'BOMB', row_idx: 2, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-2', player_slot: 2, rank: 'BOMB', row_idx: 4, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-3', player_slot: 2, rank: 'BOMB', row_idx: 3, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'marshal-enemy', player_slot: 1, rank: '1', row_idx: 3, col_idx: 6, alive: true, is_mine: false },
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
  ];
  const move = chooseBotMove(rows, 2, []);
  assert.notEqual(move.pieceId, 'sergeant-1');
});

test('chooseBotMove picks a losing capture when it is the only legal move', () => {
  const rows = [
    { piece_id: 'sergeant-1', player_slot: 2, rank: '7', row_idx: 3, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-1', player_slot: 2, rank: 'BOMB', row_idx: 2, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-2', player_slot: 2, rank: 'BOMB', row_idx: 4, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'blocker-3', player_slot: 2, rank: 'BOMB', row_idx: 3, col_idx: 4, alive: true, is_mine: true },
    { piece_id: 'marshal-enemy', player_slot: 1, rank: '1', row_idx: 3, col_idx: 6, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, []);
  assert.deepEqual(move, { pieceId: 'sergeant-1', from: { row: 3, col: 5 }, to: { row: 3, col: 6 } });
});

test('chooseBotMove returns null when the bot has no legal moves', () => {
  const rows = [
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
  ];
  assert.equal(chooseBotMove(rows, 2, []), null);
});
