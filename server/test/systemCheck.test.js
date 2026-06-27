// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the tiered recommendation engine under test.
import { getModelRecommendation, MODEL_TIERS } from '../src/core/systemCheck.js';

test('recommendation maps RAM tiers to the right models', () => {
  assert.equal(getModelRecommendation(3).model, 'qwen3:1.7b');   // micro
  assert.equal(getModelRecommendation(4).model, 'qwen3:1.7b');   // tiny
  assert.equal(getModelRecommendation(8).model, 'qwen3:4b');     // small (8 GB anchor)
  assert.equal(getModelRecommendation(16).model, 'qwen3:8b');    // medium
  assert.equal(getModelRecommendation(32).model, 'qwen3:14b');   // large
  assert.equal(getModelRecommendation(64).model, 'qwen3:32b');   // xlarge
});

test('recommendation exposes per-role models and tuning', () => {
  const rec = getModelRecommendation(8);
  assert.deepEqual(rec.models, {
    main: 'qwen3:4b',
    coding: 'qwen2.5-coder:3b',
    fast: 'qwen3:1.7b',
  });
  assert.equal(rec.context, 4096);
  assert.equal(rec.tuning.numBatch, 256);
});

test('a detected GPU steps the machine up one tier', () => {
  assert.equal(getModelRecommendation(8).model, 'qwen3:4b');
  assert.equal(getModelRecommendation(8, { gpu: true }).model, 'qwen3:8b');
  assert.equal(getModelRecommendation(8, { gpu: true }).gpuBoosted, true);
});

test('the top tier never overflows when boosted', () => {
  const top = MODEL_TIERS.at(-1);
  const rec = getModelRecommendation(4096, { gpu: true });
  assert.equal(rec.model, top.models.main);
});

test('non-numeric memory falls back to the smallest tier', () => {
  assert.equal(getModelRecommendation(undefined).model, MODEL_TIERS[0].models.main);
});
