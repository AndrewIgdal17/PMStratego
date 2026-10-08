import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../web/js/escapeHtml.js';

test('escapeHtml escapes all HTML metacharacters', () => {
  assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
});

test('escapeHtml escapes ampersands', () => {
  assert.equal(escapeHtml('A & B'), 'A &amp; B');
});

test('escapeHtml escapes single quotes', () => {
  assert.equal(escapeHtml("it's"), "it&#39;s");
});

test('escapeHtml passes through safe strings unchanged', () => {
  assert.equal(escapeHtml('andy1701'), 'andy1701');
  assert.equal(escapeHtml('hello_world_123'), 'hello_world_123');
});

test('escapeHtml handles null and undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});
