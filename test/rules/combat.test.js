import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCombat, COMBAT_OUTCOME } from '../../src/rules/combat.js';
import { RANK } from '../../src/rules/pieces.js';

test('lower rank number beats higher rank number', () => {
  assert.equal(resolveCombat(RANK.GENERAL, RANK.COLONEL), COMBAT_OUTCOME.ATTACKER_WINS);
  assert.equal(resolveCombat(RANK.COLONEL, RANK.GENERAL), COMBAT_OUTCOME.DEFENDER_WINS);
});

test('equal ranks result in a tie, both removed', () => {
  assert.equal(resolveCombat(RANK.SERGEANT, RANK.SERGEANT), COMBAT_OUTCOME.TIE);
});

test('Spy attacking the Marshal wins (the one special case)', () => {
  assert.equal(resolveCombat(RANK.SPY, RANK.MARSHAL), COMBAT_OUTCOME.ATTACKER_WINS);
});

test('Marshal attacking the Spy wins normally (Spy has no defensive power)', () => {
  assert.equal(resolveCombat(RANK.MARSHAL, RANK.SPY), COMBAT_OUTCOME.ATTACKER_WINS);
});

test('any non-Miner attacking a Bomb loses; the Bomb stays', () => {
  assert.equal(resolveCombat(RANK.MARSHAL, RANK.BOMB), COMBAT_OUTCOME.DEFENDER_WINS);
  assert.equal(resolveCombat(RANK.SCOUT, RANK.BOMB), COMBAT_OUTCOME.DEFENDER_WINS);
});

test('a Miner attacking a Bomb defuses it and wins', () => {
  assert.equal(resolveCombat(RANK.MINER, RANK.BOMB), COMBAT_OUTCOME.ATTACKER_WINS);
});

test('attacking the Flag always wins regardless of attacker rank', () => {
  assert.equal(resolveCombat(RANK.SPY, RANK.FLAG), COMBAT_OUTCOME.ATTACKER_WINS);
  assert.equal(resolveCombat(RANK.SCOUT, RANK.FLAG), COMBAT_OUTCOME.ATTACKER_WINS);
});
