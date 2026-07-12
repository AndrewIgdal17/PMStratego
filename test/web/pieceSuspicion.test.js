import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSuspects } from '../../web/js/pieceSuspicion.js';

test('a piece that has moved at least once is never suspected, no matter how long the game has run', () => {
  const history = [{ move_number: 1, piece_id: 'moved-1' }];
  const alivePieces = [{ id: 'moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'hard', 1000);
  assert.equal(suspects.has('moved-1'), false);
});

test('a never-moved piece is not suspected before the game has run long enough', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'easy', 1);
  assert.equal(suspects.has('never-moved-1'), false);
});

test('jitter boundary: a never-moved piece is suspected right at the low end of the jittered Hard threshold', () => {
  // Hard base threshold = 8. seedFn forced to 0 -> jitterFactor 0.8 -> threshold = 6.4.
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'hard', 7, () => 0);
  assert.equal(suspects.has('never-moved-1'), true, 'turn 7 should exceed a 6.4-turn threshold');
});

test('jitter boundary: a never-moved piece is NOT yet suspected just before the jittered Hard threshold', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const suspects = findSuspects(history, alivePieces, 'hard', 6, () => 0);
  assert.equal(suspects.has('never-moved-1'), false, 'turn 6 should be under a 6.4-turn threshold');
});

test('Easy has a much later threshold than Hard for the same piece and turn', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const easySuspects = findSuspects(history, alivePieces, 'easy', 10);
  const hardSuspects = findSuspects(history, alivePieces, 'hard', 10);
  assert.equal(easySuspects.has('never-moved-1'), false);
  assert.equal(hardSuspects.has('never-moved-1'), true);
});

test('only alive pieces passed in are considered -- a dead piece is never returned as a suspect', () => {
  const history = [];
  const alivePieces = []; // caller is responsible for filtering to alive, non-mine pieces
  const suspects = findSuspects(history, alivePieces, 'hard', 100);
  assert.equal(suspects.size, 0);
});

test('the same piece gets a consistent (deterministic) suspicion threshold across repeated calls', () => {
  const history = [];
  const alivePieces = [{ id: 'never-moved-1' }];
  const first = findSuspects(history, alivePieces, 'medium', 14);
  const second = findSuspects(history, alivePieces, 'medium', 14);
  assert.equal(first.has('never-moved-1'), second.has('never-moved-1'));
});
