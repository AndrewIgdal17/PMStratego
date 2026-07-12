import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBotFormationPlacements, mapFormationToAbsolute, chooseBotMove } from '../../web/js/bot.js';
import { ARMY_COMPOSITION, ARMY_SIZE } from '../../web/js/rules/pieces.js';

// Regression test for a real bug: the bot placed formations.js cells at
// the raw local row (0-3) with no slot-2 remap, so a formation's back rank
// (local row 3, where the Flag and most Bombs live) ended up on absolute
// row 3 -- the row right next to the lake, i.e. the bot's actual FRONT --
// while its front rank (local row 0) ended up on the bot's actual back row.
test('mapFormationToAbsolute keeps a formation\'s back rank at the bot\'s true back row, not the front', () => {
  const cells = [
    [0, 0, '9'],     // local front row (nearest midline)
    [3, 9, 'FLAG'],  // local back row (farthest from midline)
  ];
  const placements = mapFormationToAbsolute(cells, 2);
  assert.deepEqual(placements, [
    { rank: '9', row: 3, col: 0 },     // slot 2's front row is absolute row 3
    { rank: 'FLAG', row: 0, col: 9 },  // slot 2's back row is absolute row 0
  ]);
});

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

test('chooseBotMove treats a remembered (but currently fogged) rank as known for combat-outcome purposes', () => {
  // Live state: the enemy piece's rank is null (fog-of-war has reset it),
  // but it was revealed as a Major (4) three turns ago in combat history --
  // Colonel (3) beats Major, so this should be picked as a WINNING move
  // instead of falling into the "unknown, therefore safe" bucket.
  const rows = [
    { piece_id: 'colonel-1', player_slot: 2, rank: '3', row_idx: 5, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'major-enemy', player_slot: 1, rank: null, row_idx: 5, col_idx: 4, alive: true, is_mine: false },
  ];
  const fullMoveHistory = [
    { move_number: 1, piece_id: 'major-enemy', attacker_rank: '4', defender_piece_id: null, defender_rank: null, outcome: 'ATTACKER_WINS' },
  ];
  const move = chooseBotMove(rows, 2, fullMoveHistory, 'hard', 4);
  assert.deepEqual(move, { pieceId: 'colonel-1', from: { row: 5, col: 5 }, to: { row: 5, col: 4 } });
});

test('chooseBotMove avoids sending a valuable piece onto a suspected square when a plain alternative move exists', () => {
  // marshal-1 (Marshal, valuable) is boxed in by its own bombs on two
  // sides, leaving exactly one plain empty-square move and one attack on
  // a long-untouched (suspected) enemy square. With no winning moves
  // available, it should take the plain move, not the suspected attack.
  const rows = [
    { piece_id: 'marshal-1', player_slot: 2, rank: '1', row_idx: 3, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 2, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'bomb-2', player_slot: 2, rank: 'BOMB', row_idx: 4, col_idx: 5, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 3, col_idx: 6, alive: true, is_mine: false },
  ];
  // suspect-1 has never appeared as a mover anywhere in history, and the
  // game has run long enough (turn 20) to exceed even Hard's threshold.
  const move = chooseBotMove(rows, 2, [], 'hard', 20);
  assert.deepEqual(move, { pieceId: 'marshal-1', from: { row: 3, col: 5 }, to: { row: 3, col: 4 } });
});

test('chooseBotMove prefers probing a suspected square with a probe-eligible piece when otherwise idle and the probe roll succeeds', () => {
  // scout-1 at the board corner (0,0) has exactly two legal moves: a
  // plain step to (1,0), and an attack on suspect-1 at (2,0) (a Scout can
  // stop partway along a clear path, so both are legal destinations).
  // getLegalMoves enumerates destinations row-ascending then col-ascending
  // for a single movable piece, so (1,0) is generated before (2,0) --
  // this test relies on the probe logic actively preferring (2,0) despite
  // that natural ordering, not on ordering coincidence.
  const rows = [
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 1, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 2, col_idx: 0, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, [], 'hard', 20, () => 0);
  assert.deepEqual(move, { pieceId: 'scout-1', from: { row: 0, col: 0 }, to: { row: 2, col: 0 } });
});

test('chooseBotMove does not probe on Easy even when idle (probe probability is 0 on Easy)', () => {
  // Identical layout to the Hard probe test above, difficulty changed to
  // Easy. Probe probability 0 means `rng() < 0` is never true for any
  // rng in [0, 1), so the probe branch is unreachable regardless of rng
  // -- the bot falls back to the plain move at (1,0), the first-enumerated
  // legal move, exactly as it would if suspect-1 didn't exist at all.
  const rows = [
    { piece_id: 'scout-1', player_slot: 2, rank: '9', row_idx: 0, col_idx: 0, alive: true, is_mine: true },
    { piece_id: 'bomb-1', player_slot: 2, rank: 'BOMB', row_idx: 0, col_idx: 1, alive: true, is_mine: true },
    { piece_id: 'suspect-1', player_slot: 1, rank: null, row_idx: 2, col_idx: 0, alive: true, is_mine: false },
  ];
  const move = chooseBotMove(rows, 2, [], 'easy', 40, () => 0);
  assert.deepEqual(move, { pieceId: 'scout-1', from: { row: 0, col: 0 }, to: { row: 1, col: 0 } });
});
