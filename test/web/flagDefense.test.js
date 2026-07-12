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
