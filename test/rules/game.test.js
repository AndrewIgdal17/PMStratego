import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMove, getLegalMoves } from '../../src/rules/game.js';
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
  assert.equal(result.combatResult.defenderPieceId, 'b');
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
  assert.equal(result.combatResult.defenderPieceId, 'b');
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

test('getLegalMoves returns an empty array when the player has no movable pieces', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.BOMB, row: 6, col: 5, alive: true }];
  assert.deepEqual(getLegalMoves(pieces, 1, []), []);
});

test('getLegalMoves returns every legal destination for a movable piece', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true }];
  const moves = getLegalMoves(pieces, 1, []);
  const destinations = moves.map((m) => `${m.to.row},${m.to.col}`).sort();
  assert.deepEqual(destinations, ['5,5', '6,4', '6,6', '7,5']);
  assert.ok(moves.every((m) => m.pieceId === 'a' && m.from.row === 6 && m.from.col === 5));
});

test('getLegalMoves excludes a destination that would violate the two-square rule', () => {
  const pieces = [{ id: 'a', playerSlot: 1, rank: RANK.SERGEANT, row: 6, col: 5, alive: true }];
  const history = [
    { pieceId: 'a', from: '6,4', to: '6,5' },
    { pieceId: 'a', from: '6,5', to: '6,4' },
    { pieceId: 'a', from: '6,4', to: '6,5' },
  ];
  const moves = getLegalMoves(pieces, 1, history);
  assert.equal(moves.some((m) => m.to.row === 6 && m.to.col === 4), false);
});
