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
