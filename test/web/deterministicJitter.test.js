import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jitterFactor, defaultJitterSeed } from '../../web/js/deterministicJitter.js';

test('jitterFactor is deterministic: the same seed always produces the same factor', () => {
  const a = jitterFactor('piece-123');
  const b = jitterFactor('piece-123');
  assert.equal(a, b);
});

test('jitterFactor differs for different seeds (not a constant)', () => {
  const a = jitterFactor('piece-123');
  const b = jitterFactor('piece-456');
  assert.notEqual(a, b);
});

test('jitterFactor stays within the [0.8, 1.2] range for arbitrary seeds', () => {
  for (const seed of ['a', 'bb', 'ccc', 'piece-1', 'piece-2', 'move-99']) {
    const factor = jitterFactor(seed);
    assert.ok(factor >= 0.8 && factor <= 1.2, `factor ${factor} for seed "${seed}" out of range`);
  }
});

test('jitterFactor honors an injected seedFn for deterministic boundary testing', () => {
  assert.equal(jitterFactor('anything', () => 0), 0.8);
  assert.equal(jitterFactor('anything', () => 1), 1.2);
  assert.equal(jitterFactor('anything', () => 0.5), 1.0);
});

test('defaultJitterSeed returns a value in [0, 1)', () => {
  for (const seed of ['', 'a', 'piece-abc-123']) {
    const value = defaultJitterSeed(seed);
    assert.ok(value >= 0 && value < 1, `value ${value} for seed "${seed}" out of range`);
  }
});
