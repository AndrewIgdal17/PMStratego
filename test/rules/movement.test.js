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
