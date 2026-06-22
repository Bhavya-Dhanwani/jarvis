// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the CLI runner under test.
import { runCli } from '../src/cli/index.js';
// Import the coding agent service under test.
import { createCodingAgentService } from '../src/services/codingAgentService.js';

// Verify the CLI routes coding requests and renders workflow progress.
test('CLI code command runs the coding agent workflow', async () => {
  const lines = [];
  let receivedRequest = null;
  const review = {
    agent: 'review',
    taskId: 'review-task',
    output: 'Reviewed implementation response.',
  };
  const codingAgentService = {
    async run(request, { cwd, onEvent }) {
      receivedRequest = request;
      assert.equal(cwd, 'D:\\workspace');
      onEvent({
        type: 'task.started',
        task: {
          agent: 'backend',
          title: 'Plan backend changes',
        },
      });
      onEvent({
        type: 'task.completed',
        task: {
          agent: 'backend',
          title: 'Plan backend changes',
        },
      });

      return {
        status: 'completed',
        results: new Map([['review-task', review]]),
      };
    },
  };

  const result = await runCli(['code', 'build', 'an', 'API'], {
    codingAgentService,
    cwd: 'D:\\workspace',
    output: (line) => lines.push(line),
  });

  assert.equal(receivedRequest, 'build an API');
  assert.equal(result.status, 'completed');
  assert.equal(result.command, 'code');
  assert.deepEqual(lines, [
    '[started] backend: Plan backend changes',
    '[completed] backend: Plan backend changes',
    'Reviewed implementation response.',
  ]);
});

// Verify the command rejects empty coding requests.
test('CLI code command requires a request', async () => {
  await assert.rejects(
    () => runCli(['code']),
    /Coding request is required/,
  );
});

// Verify model-backed workers feed completed outputs into review.
test('coding agent service runs specialist agents and reviews their outputs', async () => {
  const calls = [];
  const assistantService = {
    async generateReply(messages) {
      const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
      const input = JSON.parse(messages[1].content);
      calls.push({ agent, input });
      return `${agent} output`;
    },
  };
  const service = createCodingAgentService({
    assistantService,
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
    },
  });
  const events = [];

  const result = await service.run(
    'build a frontend page with a backend API and database schema',
    {
      cwd: 'D:\\workspace',
      onEvent: (event) => events.push(event.type),
    },
  );

  assert.equal(result.status, 'completed');
  assert.equal(result.results.get('review-task').output, 'review output');
  assert.deepEqual(
    new Set(calls.map(({ agent }) => agent)),
    new Set(['frontend', 'backend', 'database', 'review']),
  );

  const reviewCall = calls.find(({ agent }) => agent === 'review');
  assert.equal(reviewCall.input.completedResults.length, 3);
  assert.deepEqual(
    new Set(reviewCall.input.completedResults.map(({ agent }) => agent)),
    new Set(['frontend', 'backend', 'database']),
  );
  assert.equal(events.filter((event) => event === 'task.started').length, 4);
  assert.equal(events.filter((event) => event === 'task.completed').length, 4);
});
