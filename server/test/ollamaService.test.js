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

// Verify multi-model routing: an explicit role picks that role's model, and chat with no
// role auto-routes (complex → main, simple → fast).
test('generateReply routes by role and auto-routes chat by complexity', async () => {
  const originalFetch = globalThis.fetch;
  const sentModels = [];

  globalThis.fetch = async (_url, init) => {
    sentModels.push(JSON.parse(init.body).model);
    return new Response(`${JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' })}\n`);
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'main-model',
      models: { main: 'main-model', coding: 'coding-model', fast: 'fast-model' },
      options: { num_ctx: 2048, num_predict: 64 },
    });

    // Explicit role wins.
    await service.generateReply([{ role: 'user', content: 'do the thing' }], { role: 'coding' });
    // Chat, complex prompt (>= 8 words) → main.
    await service.generateReply([{ role: 'user', content: 'please explain in detail how recursion works in functional programming' }]);
    // Chat, short prompt → fast.
    await service.generateReply([{ role: 'user', content: 'define recursion' }]);

    assert.deepEqual(sentModels, ['coding-model', 'main-model', 'fast-model']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify generateToolTurn defaults to the coding model.
test('generateToolTurn runs the coding model by default', async () => {
  const originalFetch = globalThis.fetch;
  let sentModel = null;

  globalThis.fetch = async (_url, init) => {
    sentModel = JSON.parse(init.body).model;
    return new Response(JSON.stringify({ message: { role: 'assistant', content: 'done' }, done: true }));
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'main-model',
      models: { main: 'main-model', coding: 'coding-model', fast: 'fast-model' },
      options: { num_ctx: 2048, num_predict: 64 },
    });

    await service.generateToolTurn([{ role: 'user', content: 'edit index.html' }], { tools: [] });

    assert.equal(sentModel, 'coding-model');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify a single-model setup (no models map) routes every role to the one model.
test('generateReply falls back to the single model when no roles are configured', async () => {
  const originalFetch = globalThis.fetch;
  const sentModels = [];

  globalThis.fetch = async (_url, init) => {
    sentModels.push(JSON.parse(init.body).model);
    return new Response(`${JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' })}\n`);
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'only-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    await service.generateReply([{ role: 'user', content: 'do the thing' }], { role: 'coding' });
    await service.generateReply([{ role: 'user', content: 'define recursion' }]);

    assert.deepEqual(sentModels, ['only-model', 'only-model']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify casual "how are you" small talk is answered locally without waking the model.
test('ollama service answers casual greetings locally', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => {
    throw new Error('fetch should not be called for casual small talk');
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    for (const greeting of ['yooo bro how are you ?', 'hey how are you doing today', 'sup']) {
      const reply = await service.generateReply([{ role: 'user', content: greeting }], { onToken: () => {} });
      assert.match(reply, /\w/);
      assert.equal(/<think>/i.test(reply), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify a real request (not small talk) still reaches the model.
test('ollama service does not localize real questions', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;

  globalThis.fetch = async () => {
    called = true;
    return new Response(`${JSON.stringify({ message: { content: 'An array is a list.' }, done: true, done_reason: 'stop' })}\n`);
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    const reply = await service.generateReply([{ role: 'user', content: 'how do I sort an array' }], { onToken: () => {} });

    assert.equal(called, true);
    assert.equal(reply, 'An array is a list.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify inline <think>...</think> reasoning is routed to the thinking channel and kept
// out of the answer, even when split across streaming chunks.
test('generateReply routes inline think tags away from the answer', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response([
    JSON.stringify({ message: { content: '<th' } }),
    JSON.stringify({ message: { content: 'ink>let me ' } }),
    JSON.stringify({ message: { content: 'reason</think>Here ' } }),
    JSON.stringify({ message: { content: 'is the answer.' } }),
    JSON.stringify({ message: { content: '' }, done: true, done_reason: 'stop' }),
  ].join('\n') + '\n');

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
      think: true,
    });

    const thinking = [];
    const tokens = [];
    const reply = await service.generateReply([
      { role: 'user', content: 'please explain in detail how a hash map resolves collisions internally' },
    ], {
      onToken: (chunk) => tokens.push(chunk),
      onThinking: (chunk) => thinking.push(chunk),
    });

    assert.equal(reply, 'Here is the answer.');
    assert.equal(tokens.join(''), 'Here is the answer.');
    assert.equal(thinking.join(''), 'let me reason');
    assert.equal(/<think>/i.test(reply), false);
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
// Verify implementation tool turns explicitly disable reasoning so coding does not pay
// the thinking tax on models that reason by default.
test('generateToolTurn disables thinking by default', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;

  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      message: { role: 'assistant', content: 'done' },
      done: true,
    }));
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    await service.generateToolTurn([{ role: 'user', content: 'edit index.html' }], { tools: [] });

    assert.equal(sentBody.think, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify a tool turn falls back to omitting think when the model has no reasoning mode.
test('generateToolTurn falls back when the model rejects think', async () => {
  const originalFetch = globalThis.fetch;
  const sentThinkValues = [];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sentThinkValues.push(body.think);

    if (body.think === false) {
      return new Response('"gemma" does not support thinking', { status: 400 });
    }

    return new Response(JSON.stringify({
      message: { role: 'assistant', content: 'done' },
      done: true,
    }));
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
    });

    const message = await service.generateToolTurn([{ role: 'user', content: 'edit index.html' }], { tools: [] });

    assert.equal(message.content, 'done');
    assert.deepEqual(sentThinkValues, [false, undefined]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify multi-model warm-up preloads every distinct role model so routing never pays a
// cold load on first use.
test('warmUp preloads all distinct role models', async () => {
  const originalFetch = globalThis.fetch;
  const warmedModels = [];

  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/api/generate')) {
      warmedModels.push(JSON.parse(init.body).model);
    }
    return new Response('{"done":true}\n');
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'main-model',
      models: { main: 'main-model', coding: 'coding-model', fast: 'fast-model' },
      options: { num_ctx: 2048, num_predict: 1 },
    });

    await service.warmUp();

    assert.deepEqual(warmedModels.sort(), ['coding-model', 'fast-model', 'main-model']);
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
      { role: 'user', content: 'explain to me in detail how recursion works in programming please' },
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

    const reply = await service.generateReply([{ role: 'user', content: 'please write a detailed explanation of how event loops work internally' }]);

    assert.equal(reply, 'ok');
    assert.deepEqual(sentThinkFlags, [true, false]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify short/casual prompts skip reasoning so they don't pay the thinking delay.
test('generateReply skips think mode for short casual prompts', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody = null;

  globalThis.fetch = async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(`${JSON.stringify({ message: { content: 'hey!' }, done: true, done_reason: 'stop' })}\n`);
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
      warmOnStart: false,
      think: true,
    });

    // A short non-greeting question (so it still hits the model rather than the local
    // small-talk path) must explicitly disable reasoning.
    await service.generateReply([{ role: 'user', content: 'do you like pizza' }], {
      onToken: () => {},
    });

    // Thinking models reason by default, so a casual prompt must explicitly disable it
    // (think:false) rather than omit the field, or the model thinks anyway.
    assert.equal(sentBody.think, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify reasoning that eats the whole budget disables thinking and retries the
// original prompt instead of injecting the confusing "continue where you stopped" turn.
test('generateReply disables thinking when reasoning overflows without an answer', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];

  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(init.body));

    if (requestBodies.length === 1) {
      // Reasoning consumed the budget: thinking streamed, no answer content, length stop.
      return new Response([
        '{"message":{"thinking":"hmm let me think"},"done":false}\n',
        '{"done":true,"done_reason":"length"}\n',
      ].join(''));
    }

    return new Response('{"message":{"content":"Hey! I am good."},"done":true,"done_reason":"stop"}\n');
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
      warmOnStart: false,
      think: true,
    });

    const reply = await service.generateReply([
      { role: 'user', content: 'please tell me in a friendly way how your day is going so far today' },
    ], { onToken: () => {} });

    assert.equal(reply, 'Hey! I am good.');
    assert.equal(requestBodies.length, 2);
    // First turn requested reasoning; the retry explicitly disables it.
    assert.equal(requestBodies[0].think, true);
    assert.equal(requestBodies[1].think, false);
    // The retry must NOT inject the "continue where you stopped" continuation prompt.
    const injected = requestBodies[1].messages.some((message) => /continue exactly where you stopped/i.test(message.content ?? ''));
    assert.equal(injected, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Verify a transient Ollama connection drop is retried instead of aborting the run.
test('ollama service retries a transient connection failure', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;

    if (calls === 1) {
      throw new TypeError('fetch failed');
    }

    return new Response(JSON.stringify({
      message: { content: 'Recovered.' },
      done: true,
      done_reason: 'stop',
    }));
  };

  try {
    const service = new OllamaService({
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      options: { num_ctx: 2048, num_predict: 64 },
      warmOnStart: false,
    });

    const reply = await service.generateReply([{ role: 'user', content: 'write an html page' }]);

    assert.equal(reply, 'Recovered.');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
