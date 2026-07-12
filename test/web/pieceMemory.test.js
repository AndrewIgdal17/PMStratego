import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPieceMemory } from '../../web/js/pieceMemory.js';

// Base combat-move shape, matching the `moves` table's columns.
function combatMove(overrides) {
  return {
    move_number: 1,
    piece_id: 'attacker-1',
    attacker_rank: '5',
    defender_piece_id: 'defender-1',
    defender_rank: '3',
    outcome: 'ATTACKER_WINS',
    ...overrides,
  };
}

test('a non-combat move (no outcome) contributes nothing to memory', () => {
  const history = [{ move_number: 1, piece_id: 'a', outcome: null, attacker_rank: null, defender_rank: null, defender_piece_id: null }];
  const memory = buildPieceMemory(history, 'hard', 10);
  assert.equal(memory.size, 0);
});

test('remembers both the attacker and defender ranks from a combat move, normalized to numbers', () => {
  const history = [combatMove({ move_number: 5 })];
  // Major (4) tier is "medium"; hard window is 15 turns, jitter range
  // [0.8, 1.2] on 15 gives [12, 18] -- age 2 is comfortably within range
  // regardless of jitter, so this test doesn't need to control the seed.
  const memory = buildPieceMemory(history, 'hard', 7);
  assert.equal(memory.get('attacker-1'), 5);
  assert.equal(memory.get('defender-1'), 3);
});

test('BOMB and FLAG ranks are handled without Number() coercion breaking them', () => {
  const history = [combatMove({ move_number: 1, defender_rank: 'BOMB', attacker_rank: '8' })];
  const memory = buildPieceMemory(history, 'hard', 2);
  assert.equal(memory.get('defender-1'), 'BOMB');
});

test('a Scout (minor tier) reveal is forgotten immediately on Easy (0-turn window)', () => {
  const history = [combatMove({ move_number: 1, attacker_rank: '9' })];
  const memory = buildPieceMemory(history, 'easy', 1);
  assert.equal(memory.has('attacker-1'), false);
});

test('a Scout reveal is remembered briefly on Medium (2-turn base window)', () => {
  const history = [combatMove({ move_number: 10, attacker_rank: '9' })];
  // age 1 is within even the low end of jitter (2 * 0.8 = 1.6, so age 1 <= 1.6)
  const memory = buildPieceMemory(history, 'medium', 11);
  assert.equal(memory.get('attacker-1'), 9);
});

test('jitter boundary: a Colonel (high tier) reveal at exactly the low end of the jittered window is still remembered', () => {
  // High tier, medium difficulty base window = 10. seedFn forced to 0 -> jitterFactor 0.8 -> window = 8.
  const history = [combatMove({ move_number: 1, attacker_rank: '3' })];
  const memory = buildPieceMemory(history, 'medium', 9, () => 0);
  assert.equal(memory.get('attacker-1'), 3, 'age 8 should be within an 8-turn window');
});

test('jitter boundary: a Colonel reveal just past the low end of the jittered window is forgotten', () => {
  const history = [combatMove({ move_number: 1, attacker_rank: '3' })];
  const memory = buildPieceMemory(history, 'medium', 10, () => 0);
  assert.equal(memory.has('attacker-1'), false, 'age 9 should exceed an 8-turn window');
});

test('Bomb is remembered for the whole game even on Easy difficulty (special-cased, not scaled)', () => {
  const history = [combatMove({ move_number: 1, defender_rank: 'BOMB', attacker_rank: '8' })];
  const memory = buildPieceMemory(history, 'easy', 500, () => 1);
  assert.equal(memory.get('defender-1'), 'BOMB');
});

test('Marshal (critical tier, mobile) is NOT remembered forever on Easy -- only Bomb gets the unconditional-Infinity special case', () => {
  const history = [combatMove({ move_number: 1, attacker_rank: '1' })];
  // Easy critical-tier base window is 5; even at jitter factor 1.2, window = 6.
  const memory = buildPieceMemory(history, 'easy', 500, () => 1);
  assert.equal(memory.has('attacker-1'), false);
});

test('the most recent reveal of the same piece overwrites an earlier one', () => {
  const history = [
    combatMove({ move_number: 1, piece_id: 'p1', attacker_rank: '5', defender_piece_id: null, defender_rank: null }),
    combatMove({ move_number: 2, piece_id: 'p1', attacker_rank: '5', defender_piece_id: null, defender_rank: null }),
  ];
  const memory = buildPieceMemory(history, 'hard', 3);
  assert.equal(memory.get('p1'), 5);
  assert.equal(memory.size, 1);
});

test('FLAG reveals are ignored (covered by suspicion, not memory -- Flag never has an importance tier)', () => {
  const history = [combatMove({ move_number: 1, defender_rank: 'FLAG', attacker_rank: '2' })];
  const memory = buildPieceMemory(history, 'hard', 2);
  assert.equal(memory.has('defender-1'), false);
});
