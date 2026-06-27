// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import temporary directory helpers.
import { mkdtempSync, writeFileSync } from 'node:fs';
// Import tmpdir for isolated test files.
import { tmpdir } from 'node:os';
// Import join for config paths.
import { join } from 'node:path';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the model config builder under test.
import { createModelConfig, loadSavedModelConfig } from '../src/services/modelConfigService.js';

// Verify setup config is the runtime source of truth.
test('model config prefers setup-selected model over environment model', () => {
  // Create an isolated saved config file.
  const configPath = join(mkdtempSync(join(tmpdir(), 'jarvis-config-')), 'config.json');
  // Write the model a user selected during setup.
  writeFileSync(configPath, JSON.stringify({
    model: 'gemma4:e2b',
    host: 'http://127.0.0.1:11434',
  }));

  // Build runtime config with a conflicting old env override.
  const config = createModelConfig({
    totalMemoryGb: 32,
    env: {
      JARVIS_CONFIG_PATH: configPath,
      JARVIS_OLLAMA_MODEL: 'gemma3:1b',
    },
  });

  // Assert the setup-selected model wins.
  assert.equal(config.model, 'gemma4:e2b');
  // Assert diagnostics can explain the source.
  assert.equal(config.source, 'saved-config');
});

// Verify environment model still works before setup config exists.
test('model config uses environment model when no saved setup config exists', () => {
  // Build runtime config with a missing explicit config path.
  const config = createModelConfig({
    totalMemoryGb: 32,
    env: {
      JARVIS_CONFIG_PATH: join(tmpdir(), 'missing-jarvis-config.json'),
      JARVIS_OLLAMA_MODEL: 'gemma3:1b',
    },
  });

  // Assert env remains the fallback before setup has saved a model.
  assert.equal(config.model, 'gemma3:1b');
  // Assert diagnostics can explain the source.
  assert.equal(config.source, 'env');
});

// Verify startup warm-up is enabled by default and can still be disabled.
test('model config uses gentle startup warm-up unless explicitly disabled', () => {
  const defaultConfig = createModelConfig({
    totalMemoryGb: 16,
    env: missingConfigEnv(),
  });
  const disabledConfig = createModelConfig({
    totalMemoryGb: 16,
    env: {
      ...missingConfigEnv(),
      JARVIS_OLLAMA_WARMUP: 'false',
    },
  });

  assert.equal(defaultConfig.warmOnStart, true);
  assert.equal(disabledConfig.warmOnStart, false);
});

// Verify generation settings adapt to the detected memory profile.
test('model config tunes streaming settings from system profile', () => {
  // Build configs across the recommendation tiers (8/16/32/64 GB).
  const small = createModelConfig({ totalMemoryGb: 8, env: missingConfigEnv() });
  const medium = createModelConfig({ totalMemoryGb: 16, env: missingConfigEnv() });
  const large = createModelConfig({ totalMemoryGb: 32, env: missingConfigEnv() });
  const xlarge = createModelConfig({ totalMemoryGb: 64, env: missingConfigEnv() });

  // 8 GB anchor (small tier, qwen3:4b).
  assert.deepEqual(pickTuning(small), {
    numBatch: 256,
    codeChunkTokens: 512,
    codeContext: 4096,
    keepAlive: '30m',
    maxAutoContinuations: 12,
  });

  // Assert each larger profile steps up capacity from the system check.
  assert.deepEqual(pickTuning(medium), {
    numBatch: 512,
    codeChunkTokens: 768,
    codeContext: 8192,
    keepAlive: '30m',
    maxAutoContinuations: 14,
  });
  assert.deepEqual(pickTuning(large), {
    numBatch: 512,
    codeChunkTokens: 1024,
    codeContext: 16384,
    keepAlive: '30m',
    maxAutoContinuations: 16,
  });
  assert.deepEqual(pickTuning(xlarge), {
    numBatch: 512,
    codeChunkTokens: 1024,
    codeContext: 32768,
    keepAlive: '30m',
    maxAutoContinuations: 16,
  });
});

// Verify malformed config files are ignored.
test('saved model config ignores malformed config files', () => {
  // Create an isolated malformed config file.
  const configPath = join(mkdtempSync(join(tmpdir(), 'jarvis-config-')), 'config.json');
  // Write invalid JSON.
  writeFileSync(configPath, '{');

  // Assert malformed config does not crash config loading.
  assert.equal(loadSavedModelConfig({ env: { JARVIS_CONFIG_PATH: configPath } }), null);
});

function missingConfigEnv() {
  return {
    JARVIS_CONFIG_PATH: join(tmpdir(), `missing-jarvis-config-${Math.random()}.json`),
  };
}

function pickTuning(config) {
  return {
    numBatch: config.options.num_batch,
    codeChunkTokens: config.options.code_num_predict,
    codeContext: config.options.code_num_ctx,
    keepAlive: config.keepAlive,
    maxAutoContinuations: config.maxAutoContinuations,
  };
}
