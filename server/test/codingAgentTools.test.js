// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the path-inference helper under test.
import { inferWriteFilePath } from '../src/services/codingAgentService.js';

test('infers index.html from HTML content', () => {
  assert.equal(inferWriteFilePath('<!DOCTYPE html><html><body>hi</body></html>'), 'index.html');
});

test('infers script.js from JavaScript content', () => {
  assert.equal(inferWriteFilePath('const add = (a, b) => a + b; document.title = "x";'), 'script.js');
});

test('infers style.css from CSS content', () => {
  assert.equal(inferWriteFilePath('.btn { color: red; padding: 4px; }'), 'style.css');
});

test('skips a filename already written so files do not collide', () => {
  const written = new Set(['index.html']);
  const next = inferWriteFilePath('<html><div>second</div></html>', written);
  assert.notEqual(next, 'index.html');
  assert.ok(next);
});

test('falls back to a web filename for ambiguous content', () => {
  assert.ok(['index.html', 'script.js', 'style.css'].includes(inferWriteFilePath('plain notes')));
});
