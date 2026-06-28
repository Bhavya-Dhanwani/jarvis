// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import temporary folder helpers.
import { mkdtempSync } from 'node:fs';
// Import the OS temporary folder.
import { tmpdir } from 'node:os';
// Import path helper.
import { join } from 'node:path';
// Import streams to simulate CLI input and output.
import { Readable, Writable } from 'node:stream';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the CLI runner under test.
import { runCli } from '../src/cli/index.js';
// Import database initializer for isolated test databases.
import { createInitializedDatabase } from '../src/database/connection.js';
// Import message repository for persistence assertions.
import { MessageRepository } from '../src/repositories/messageRepository.js';
// Import coding intent service under test.
import { createCodingIntentService } from '../src/services/codingIntentService.js';

// Verify the model classifier accepts JSON wrapped in model formatting.
test('coding intent service lets the model choose coding mode', async () => {
  const service = createCodingIntentService({
    assistantService: {
      async generateReply() {
        return '```json\n{"intent":"code","reason":"The user asked to modify files."}\n```';
      },
    },
  });

  const decision = await service.classify('fix the API route');

  assert.equal(decision.intent, 'code');
  assert.match(decision.reason, /modify files/);
});

// Verify intent routing runs cheaply: it must never reason and must cap its output,
// because it executes before every answer and would otherwise double response latency.
test('coding intent service classifies without reasoning', async () => {
  let receivedOptions = null;
  const service = createCodingIntentService({
    assistantService: {
      async generateReply(_messages, options) {
        receivedOptions = options;
        return '{"intent":"chat","reason":"ordinary question"}';
      },
    },
  });

  // Use a workspace-action prompt so it actually reaches the model (plain questions are
  // now routed to chat locally without a model call).
  await service.classify('refactor the auth module and add a test');

  assert.equal(receivedOptions.think, false);
  assert.equal(receivedOptions.maxContinuations, 0);
  assert.equal(receivedOptions.generationOptions.num_predict, 64);
});

// Verify plain questions never pay the classification round trip — they route to chat
// locally so the answer can start streaming immediately.
test('coding intent service routes plain questions to chat without a model call', async () => {
  let calls = 0;
  const service = createCodingIntentService({
    assistantService: {
      async generateReply() {
        calls += 1;
        return '{"intent":"code","reason":"should not be asked"}';
      },
    },
  });

  for (const question of ['what is recursion', 'explain closures in javascript', 'how does a hashmap work']) {
    const decision = await service.classify(question);
    assert.equal(decision.intent, 'chat');
  }

  assert.equal(calls, 0);
});

// Verify a workspace-action prompt still gets the careful model decision.
test('coding intent service consults the model for workspace-action prompts', async () => {
  let calls = 0;
  const service = createCodingIntentService({
    assistantService: {
      async generateReply() {
        calls += 1;
        return '{"intent":"code","reason":"edits files"}';
      },
    },
  });

  const decision = await service.classify('add a logout button to the navbar component');

  assert.equal(calls, 1);
  assert.equal(decision.intent, 'code');
});

// Verify malformed classifier output safely stays in chat mode.
test('coding intent service falls back to chat mode', async () => {
  const service = createCodingIntentService({
    assistantService: {
      async generateReply() {
        return 'I am not sure.';
      },
    },
  });

  const decision = await service.classify('tell me about APIs');

  assert.equal(decision.intent, 'chat');
});

// Verify a normal chat prompt can automatically enter the coding workflow.
test('Jarvis chat automatically routes coding prompts and persists the result', async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'jarvis-intent-')), 'jarvis.sqlite');
  const database = createInitializedDatabase(databasePath);
  const messageRepository = new MessageRepository(database);
  const output = createOutputCapture();
  const calls = [];
  const codingAgentService = {
    intentService: {
      async classify(message, { cwd }) {
        calls.push({ type: 'classify', message, cwd });
        return {
          intent: 'code',
          reason: 'Workspace changes requested.',
        };
      },
    },
    async run(request, { cwd }) {
      calls.push({ type: 'code', request, cwd });
      return {
        status: 'completed',
        results: new Map([['review-task', {
          output: 'The coding workflow completed.',
        }]]),
      };
    },
  };

  try {
    const result = await runCli([], {
      database,
      cwd: 'D:\\projects\\automatic',
      input: Readable.from([
        'fix the API route and add a test\n',
        '/exit\n',
      ]),
      outputStream: output.stream,
      output: output.writeLine,
      codingAgentService,
      assistantService: {
        async generateReply() {
          throw new Error('Coding prompts must not use the normal chat response.');
        },
      },
    });
    const messages = messageRepository.listByChatId(result.chatId);

    assert.deepEqual(calls, [
      {
        type: 'classify',
        message: 'fix the API route and add a test',
        cwd: 'D:\\projects\\automatic',
      },
      {
        type: 'code',
        request: 'fix the API route and add a test',
        cwd: 'D:\\projects\\automatic',
      },
    ]);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].content, 'fix the API route and add a test');
    assert.equal(messages[1].content, 'The coding workflow completed.');
    assert.match(output.text(), /The coding workflow completed/);
  } finally {
    database.close();
  }
});

// Verify chat intent preserves the existing assistant path.
test('Jarvis chat keeps conversational prompts on the normal assistant path', async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'jarvis-chat-intent-')), 'jarvis.sqlite');
  const database = createInitializedDatabase(databasePath);
  const output = createOutputCapture();
  let codingRuns = 0;
  const codingAgentService = {
    intentService: {
      async classify() {
        return {
          intent: 'chat',
          reason: 'No workspace changes requested.',
        };
      },
    },
    async run() {
      codingRuns += 1;
    },
  };

  try {
    await runCli([], {
      database,
      input: Readable.from([
        'explain what an API is\n',
        '/exit\n',
      ]),
      outputStream: output.stream,
      output: output.writeLine,
      codingAgentService,
      assistantService: {
        async generateReply() {
          return 'An API is a contract between software systems.';
        },
      },
    });

    assert.equal(codingRuns, 0);
    assert.match(output.text(), /An API is a contract/);
  } finally {
    database.close();
  }
});

// Create a writable stream that records all output.
function createOutputCapture() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk).toString('utf8'));
      callback();
    },
  });

  return {
    stream,
    writeLine(value) {
      chunks.push(`${value}\n`);
    },
    text() {
      return chunks.join('');
    },
  };
}
