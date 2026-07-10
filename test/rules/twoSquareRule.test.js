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
