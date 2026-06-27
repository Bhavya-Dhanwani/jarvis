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

  // num_ctx stays fixed at the session value (changing it would reload the model);
  // only num_predict adapts. Internal tuning keys are stripped before sending.
  assert.equal(options.num_ctx, 2048);
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

// Verify blank model generations are marked as safe to retry.
test('ollama service marks empty responses as transient', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
    message: {
      content: '',
    },
    done: true,
    done_reason: 'stop',
  }), {
      headers: {
        'content-type': 'application/json',
      },
    });
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    await assert.rejects(
      () => service.generateReply([
        { role: 'user', content: 'write an html page' },
      ]),
      (error) => error.message === 'Ollama returned an empty response after retrying.'
        && error.transient === true
        && error.code === 'OLLAMA_EMPTY_RESPONSE',
    );
    assert.equal(requests, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
// Verify a one-off empty response is retried before surfacing an error.
test('ollama service retries empty non-streaming responses', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];

  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));

    if (requestBodies.length === 1) {
      return new Response(JSON.stringify({
        message: { content: '' },
        done: true,
        done_reason: 'stop',
      }));
    }

    return new Response(JSON.stringify({
      message: { content: 'Recovered reply.' },
      done: true,
      done_reason: 'stop',
    }));
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    const reply = await service.generateReply([
      { role: 'user', content: 'write an html page' },
    ]);

    assert.equal(reply, 'Recovered reply.');
    assert.equal(requestBodies.length, 2);
    assert.match(requestBodies[1].messages.at(-1).content, /previous response was empty/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify Ollama native tool calls can have empty content and survive the recall round trip.
test('ollama service sends tools and preserves tool-call context', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];

  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));

    if (requestBodies.length === 1) {
      return new Response(JSON.stringify({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            function: {
              name: 'read_file',
              arguments: { path: 'index.html' },
            },
          }],
        },
        done: true,
      }));
    }

    return new Response(JSON.stringify({
      message: { role: 'assistant', content: 'File inspected.' },
      done: true,
    }));
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });
    const tools = [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file.',
        parameters: { type: 'object', properties: {} },
      },
    }];
    const first = await service.generateToolTurn([
      { role: 'user', content: 'inspect index.html' },
    ], { tools });
    const second = await service.generateToolTurn([
      { role: 'user', content: 'inspect index.html' },
      first,
      { role: 'tool', tool_name: 'read_file', content: '<html></html>' },
    ], { tools });

    assert.equal(first.tool_calls[0].function.name, 'read_file');
    assert.equal(second.content, 'File inspected.');
    assert.deepEqual(requestBodies[0].tools, tools);
    assert.equal(requestBodies[1].messages.at(-2).tool_calls[0].function.name, 'read_file');
    assert.equal(requestBodies[1].messages.at(-1).tool_name, 'read_file');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
// Coalesce simultaneous warm-up calls into one Ollama model load.
test('ollama service warms a model only once concurrently', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  let requests = 0;

  globalThis.fetch = async (_url, init) => {
    requests += 1;
    requestBodies.push(JSON.parse(init.body));
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response('{"done":true}\n');
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      keepAlive: '5m',
      options: { num_ctx: 4096, num_batch: 512, num_predict: 64 },
    });

    await Promise.all([service.warmUp(), service.warmUp(), service.warmUp()]);
    await service.warmUp();

    assert.equal(requests, 1);
    assert.equal(requestBodies[0].keep_alive, '30s');
    // Warm-up loads the model at the SAME num_ctx/num_batch as real requests so the
    // first prompt does not force a reload; only num_predict is shrunk to 1.
    assert.equal(requestBodies[0].options.num_ctx, 4096);
    assert.equal(requestBodies[0].options.num_batch, 512);
    assert.equal(requestBodies[0].options.num_predict, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Reuse an in-flight background warm-up instead of sending a concurrent prompt load.
test('ollama service waits for background warm-up before model requests', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let releaseWarmup;

  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(init.body) });

    if (String(url).endsWith('/api/generate')) {
      await new Promise((resolve) => {
        releaseWarmup = resolve;
      });
      return new Response('{"done":true}\n');
    }

    return new Response(JSON.stringify({
      message: { content: 'Ready.' },
      done: true,
      done_reason: 'stop',
    }));
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    const warmup = service.warmUp();
    const reply = service.generateReply([
      { role: 'user', content: 'tell me something useful' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/api\/generate$/);

    releaseWarmup();

    assert.equal(await reply, 'Ready.');
    await warmup;
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /\/api\/chat$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


// Verify reasoning is streamed separately from the answer and think:true is requested.
test('generateReply streams thinking separately and requests think mode', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;

  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    const lines = [
      JSON.stringify({ message: { thinking: 'Let me ' } }),
      JSON.stringify({ message: { thinking: 'reason.' } }),
      JSON.stringify({ message: { content: 'Hello' } }),
      JSON.stringify({ message: { content: ' world' } }),
      JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }),
    ].join('\n') + '\n';
    return new Response(lines);
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
      warmOnStart: false,
      think: true,
    });

    const thinking = [];
    const tokens = [];
    const reply = await service.generateReply([
      { role: 'user', content: 'explain something to me' },
    ], {
      onToken: (chunk) => tokens.push(chunk),
      onThinking: (chunk) => thinking.push(chunk),
    });

    assert.equal(reply, 'Hello world');
    assert.equal(thinking.join(''), 'Let me reason.');
    assert.equal(tokens.join(''), 'Hello world');
    assert.equal(sentBody.think, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify a model that rejects thinking falls back and still answers.
test('generateReply retries without think when the model rejects it', async () => {
  const originalFetch = globalThis.fetch;
  const sentThinkFlags = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sentThinkFlags.push(body.think === true);

    if (body.think === true) {
      return new Response('"gemma" does not support thinking', { status: 400 });
    }

    return new Response(`${JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' })}\n`);
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
      warmOnStart: false,
      think: true,
    });

    const reply = await service.generateReply([{ role: 'user', content: 'plain question here' }]);

    assert.equal(reply, 'ok');
    assert.deepEqual(sentThinkFlags, [true, false]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
