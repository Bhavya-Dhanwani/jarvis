// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import Node's built-in test runner.
import test from 'node:test';
// Import adaptive generation option helper.
import { createRequestOptions, OllamaService } from '../src/services/ollamaService.js';

// Verify small talk stays fast.
test('request options keep greetings short', () => {
  // Build options for a simple greeting.
  const options = createRequestOptions({ num_ctx: 2048, num_predict: 64 }, [
    { role: 'user', content: 'hello' },
  ]);

  // Assert greetings keep the short response cap.
  assert.equal(options.num_predict, 64);
});

// Verify coding prompts are not starved by the default short cap.
test('request options raise token budget for coding prompts', () => {
  // Build options for a coding request.
  const options = createRequestOptions({ num_ctx: 2048, num_predict: 64 }, [
    { role: 'user', content: 'give me a java code to solve the N Queens problem of leetcode' },
  ]);

  // Assert coding requests use smaller chunks that stream more smoothly.
  assert.equal(options.num_predict, 384);
  // Assert coding requests use the configured context instead of forcing a larger one.
  assert.equal(options.num_ctx, 2048);
});

// Verify normal questions get a middle budget.
test('request options raise token budget for normal questions', () => {
  // Build options for a non-trivial general question.
  const options = createRequestOptions({ num_ctx: 2048, num_predict: 64 }, [
    { role: 'user', content: 'what programming languages do you know?' },
  ]);

  // Assert general questions are not capped like greetings.
  assert.equal(options.num_predict, 256);
});

// Verify Jarvis-only tuning keys are not sent to Ollama.
test('request options strip internal Jarvis tuning keys', () => {
  // Build options with internal app tuning fields.
  const options = createRequestOptions({
    num_ctx: 2048,
    num_predict: 64,
    code_num_ctx: 3072,
    code_num_predict: 512,
  }, [
    { role: 'user', content: 'write a program of N Queens in js' },
  ]);

  // Assert the internal fields were consumed before sending to Ollama.
  assert.equal(options.num_ctx, 3072);
  assert.equal(options.num_predict, 512);
  assert.equal('code_num_ctx' in options, false);
  assert.equal('code_num_predict' in options, false);
});

// Verify tiny social messages do not wake the local model.
test('ollama service answers tiny greetings locally', async () => {
  const originalFetch = globalThis.fetch;
  const streamedTokens = [];

  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for local fast replies');
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    const reply = await service.generateReply([
      { role: 'user', content: 'hi' },
    ], {
      onToken: (chunk) => streamedTokens.push(chunk),
    });

    assert.equal(reply, 'Hi! How can I help?');
    assert.deepEqual(streamedTokens, ['Hi! How can I help?']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify streamed replies auto-continue when Ollama hits the token limit.
test('ollama service streams automatic continuations', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  const streamedTokens = [];

  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));

    if (requestBodies.length === 1) {
      return new Response([
        '{"message":{"content":"first "},"done":false}\n',
        '{"done":true,"done_reason":"length"}\n',
      ].join(''));
    }

    return new Response('{"message":{"content":"second"},"done":true,"done_reason":"stop"}\n');
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      keepAlive: '2m',
      maxAutoContinuations: 1,
      options: {
        num_ctx: 2048,
        num_predict: 64,
        code_num_predict: 384,
      },
    });

    const reply = await service.generateReply([
      { role: 'user', content: 'write a program of N Queens in js' },
    ], {
      onToken: (chunk) => streamedTokens.push(chunk),
    });

    assert.equal(reply, 'first second');
    assert.deepEqual(streamedTokens, ['first ', '\n', 'second']);
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0].stream, true);
    assert.equal(requestBodies[0].options.num_predict, 384);
    assert.equal(requestBodies[1].messages.at(-2).role, 'assistant');
    assert.equal(requestBodies[1].messages.at(-2).content, 'first ');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
