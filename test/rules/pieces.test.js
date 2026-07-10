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
