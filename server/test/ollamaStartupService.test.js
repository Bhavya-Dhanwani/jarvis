import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ensureOllamaReady,
  formatOllamaSetupRequired,
} from '../src/services/ollamaStartupService.js';

test('ollama startup check passes when server and model are available', async () => {
  const result = await ensureOllamaReady({
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'gemma4:e2b',
    },
    fetchImpl: async () => new Response(JSON.stringify({
      models: [{ name: 'gemma4:e2b' }],
    })),
  });

  assert.equal(result.ready, true);
});

test('ollama startup check starts server when tags are initially unreachable', async () => {
  let requests = 0;
  let starts = 0;
  const result = await ensureOllamaReady({
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'gemma4:e2b',
    },
    startServer: async () => {
      starts += 1;
      return { started: true };
    },
    fetchImpl: async () => {
      requests += 1;

      if (requests === 1) {
        throw new Error('server down');
      }

      return new Response(JSON.stringify({
        models: [{ name: 'gemma4:e2b' }],
      }));
    },
    timeoutMs: 20,
    pollIntervalMs: 1,
  });

  assert.equal(starts, 1);
  assert.equal(result.ready, true);
});

test('ollama startup check asks for setup when model is missing', async () => {
  const modelConfig = {
    host: 'http://127.0.0.1:11434',
    model: 'missing-model',
  };
  const result = await ensureOllamaReady({
    modelConfig,
    fetchImpl: async () => new Response(JSON.stringify({
      models: [{ name: 'gemma4:e2b' }],
    })),
  });

  assert.equal(result.ready, false);
  assert.match(result.reason, /missing-model/);
  assert.match(formatOllamaSetupRequired(result, modelConfig), /jarvis setup/);
});

test('ollama startup check does not start local server for remote hosts', async () => {
  const modelConfig = {
    host: 'https://client-host.trycloudflare.com',
    model: 'gemma4:e4b',
  };
  let starts = 0;
  const result = await ensureOllamaReady({
    modelConfig,
    startServer: async () => {
      starts += 1;
      return { started: true };
    },
    fetchImpl: async () => {
      throw new Error('remote tunnel down');
    },
  });
  const message = formatOllamaSetupRequired(result, modelConfig);

  assert.equal(starts, 0);
  assert.equal(result.ready, false);
  assert.equal(result.remote, true);
  assert.match(message, /On the host device/);
  assert.match(message, /jarvis/);
  assert.doesNotMatch(message, /install\/start Ollama/);
});
