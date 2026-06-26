// Import strict assertions for tests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the CLI runner under test.
import { renderCliError, runCli } from '../src/cli/index.js';
// Import the coding agent service under test.
import { createCodingAgentService } from '../src/services/codingAgentService.js';
import { createWorkspaceToolService } from '../src/services/workspaceToolService.js';
import { createTerminalUi } from '../src/cli/terminalUi.js';

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
    '',
    '[started] backend: Plan backend changes',
    '[completed] backend: Plan backend changes',
    'Reviewed implementation response.',
  ]);
});

// Verify quality-loop progress events render without requiring a task object.
test('terminal UI renders quality events without task metadata', () => {
  const chunks = [];
  const ui = createTerminalUi({
    output: {
      isTTY: false,
      write: (chunk) => chunks.push(chunk),
    },
    cwd: 'D:\\workspace',
  });

  ui.taskEvent({ type: 'quality.pass.started', pass: 1 });
  ui.taskEvent({ type: 'quality.pass.completed', pass: 1 });
  ui.taskEvent({ type: 'quality.rework.requested', pass: 1 });
  ui.taskEvent({ type: 'unknown.event', message: 'still safe' });

  const output = chunks.join('');
  assert.match(output, /quality pass/);
  assert.match(output, /rework requested after pass 1/);
  assert.match(output, /unknown\.event/);
});

// Verify the command rejects empty coding requests.
test('CLI code command requires a request', async () => {
  await assert.rejects(
    () => runCli(['code']),
    /Coding request is required/,
  );
});

// Verify direct code mode checks Ollama readiness before running agents.
test('CLI code command asks for setup when Ollama is not ready', async () => {
  const lines = [];
  const result = await runCli(['code', 'build', 'an', 'API'], {
    output: (line) => lines.push(line),
    ensureOllamaReady: async () => ({
      ready: false,
      reason: 'Ollama is not running and Jarvis could not start it.',
    }),
  });

  assert.equal(result.status, 'setup-required');
  assert.match(lines.join('\n'), /jarvis setup/);
});

// Verify fatal CLI errors are action-oriented instead of raw thrown text.
test('CLI fatal auth errors render with setup guidance', () => {
  const output = renderCliError(new Error('Client mode needs auth. Run "jarvis setup" or "jarvis change" and login first.'));

  assert.match(output, /Client mode is missing saved auth/);
  assert.match(output, /jarvis setup/);
});

// Verify host mode publishes the URL instead of opening the chat UI.
test('CLI host mode publishes temporary Ollama URL and exits', async () => {
  const dataRoot = mkdtempSync(join(tmpdir(), 'jarvis-host-'));
  const configPath = join(dataRoot, 'config.json');
  const authPath = join(dataRoot, 'auth.json');
  const lines = [];
  const tunnelOutput = [];
  const published = [];

  writeFileSync(configPath, JSON.stringify({
    mode: 'host',
    model: 'gemma4:e4b',
    host: 'http://localhost:11434',
    dataRoot,
    signalingServerUrl: 'https://jarvis.example.com',
  }));
  writeFileSync(authPath, JSON.stringify({
    refreshToken: 'refresh-token',
    serverUrl: 'https://jarvis.example.com',
  }));

  const result = await runCli([], {
    env: {
      JARVIS_CONFIG_PATH: configPath,
    },
    output: (line) => lines.push(line),
    outputStream: {
      write: (chunk) => tunnelOutput.push(String(chunk)),
    },
    ensureOllamaReady: async () => ({ ready: true }),
    refreshAccessToken: async ({ serverUrl, refreshToken }) => {
      assert.equal(serverUrl, 'https://jarvis.example.com');
      assert.equal(refreshToken, 'refresh-token');
      return 'access-token';
    },
    startBestTunnel: async ({ localUrl, dataRoot: tunnelDataRoot, output }) => {
      assert.equal(localUrl, 'http://localhost:11434');
      assert.equal(tunnelDataRoot, dataRoot);
      output.write('Tunnel online through cloudflared: https://host.trycloudflare.com\n');
      return {
        provider: 'cloudflared',
        url: 'https://host.trycloudflare.com',
      };
    },
    publishOllamaUrl: async (payload) => {
      published.push(payload);
      return { success: true };
    },
  });

  assert.equal(result.command, 'host');
  assert.equal(result.publishedUrl, 'https://host.trycloudflare.com');
  assert.deepEqual(published, [{
    serverUrl: 'https://jarvis.example.com',
    accessToken: 'access-token',
    ollamaUrl: 'https://host.trycloudflare.com',
  }]);
  assert.match(lines.join('\n'), /Host mode is online/);
  assert.match(tunnelOutput.join(''), /Tunnel online/);
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
    new Set(['planner', 'prd', 'frontend', 'backend', 'database', 'testing', 'review']),
  );

  const reviewCall = calls.find(({ agent }) => agent === 'review');
  assert.equal(reviewCall.input.completedResults.length, 6);
  assert.deepEqual(
    new Set(reviewCall.input.completedResults.map(({ agent }) => agent)),
    new Set(['planner', 'prd', 'frontend', 'backend', 'database', 'testing']),
  );
  assert.equal(events.filter((event) => event === 'task.started').length, 7);
  assert.equal(events.filter((event) => event === 'task.completed').length, 7);
});

// Verify HTML/CSS/JS requests are assigned to the frontend specialist.
test('coding agent service routes chat interface requests to frontend', async () => {
  const calls = [];
  const service = createCodingAgentService({
    assistantService: {
      async generateReply(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
        calls.push(agent);
        return `${agent} output`;
      },
    },
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
    },
  });

  const result = await service.run(
    'make a chat interface using html and css and basic js in a single file',
  );

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, ['planner', 'prd', 'frontend', 'testing', 'review']);
});

// Verify CLI coding failures do not masquerade as successful review completion.
test('CLI code command surfaces the failed agent error', async () => {
  const codingAgentService = {
    async run() {
      const error = new Error('Ollama returned an empty response.');

      return {
        status: 'failed',
        tasks: [{
          id: 'frontend-task',
          title: 'Plan frontend changes',
          agent: 'frontend',
        }],
        results: new Map(),
        failedTasks: new Map([['frontend-task', error]]),
      };
    },
  };

  await assert.rejects(
    () => runCli(['code', 'build', 'a', 'page'], { codingAgentService }),
    /frontend agent \(Plan frontend changes\) failed: Ollama returned an empty response/,
  );
});
// Verify implementation agents execute native tool calls and recall the model with results.
test('coding agent executes workspace tools and returns results to the model', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-tools-'));
  const calls = [];
  const events = [];
  let frontendTurns = 0;
  const assistantService = {
    async generateReply(messages) {
      const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
      calls.push(agent);
      return `${agent} output`;
    },
    async generateToolTurn(messages, { tools }) {
      const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
      calls.push(agent);

      if (agent === 'testing' || agent === 'review') {
        assert.equal(tools.some((entry) => entry.function.name === 'write_file'), false);
        return { role: 'assistant', content: agent === 'testing' ? 'Verified index.html.' : 'Created and reviewed index.html.' };
      }

      frontendTurns += 1;
      assert.equal(tools.some((entry) => entry.function.name === 'write_file'), true);

      if (frontendTurns === 1) {
        return {
          role: 'assistant',
          content: '',
          tool_calls: [{
            function: {
              name: 'write_file',
              arguments: {
                path: 'index.html',
                content: '<!doctype html><title>Jarvis Chat</title>',
              },
            },
          }],
        };
      }

      return {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'finish_file', arguments: { path: 'index.html' } } }],
      };
    },
  };
  const service = createCodingAgentService({
    assistantService,
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
    },
  });

  const result = await service.run('create a single HTML chat interface', {
    cwd,
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.status, 'completed');
  assert.equal(await readFile(join(cwd, 'index.html'), 'utf8'), '<!doctype html><title>Jarvis Chat</title>');
  assert.deepEqual(calls, ['planner', 'prd', 'frontend', 'frontend', 'testing', 'review']);
  assert.equal(events.some((event) => event.type === 'tool.started' && event.tool === 'write_file'), true);
  assert.equal(events.some((event) => event.type === 'tool.completed' && event.tool === 'write_file'), true);
});
// Verify command discovery is available without opening a chat.
test('CLI commands command prints interactive commands', async () => {
  const lines = [];
  const result = await runCli(['commands'], { output: (line) => lines.push(line) });

  assert.equal(result.command, 'commands');
  assert.match(lines.join('\n'), /\/commands/);
  assert.match(lines.join('\n'), /\/code <request>/);
});

// Reject missing file paths before filesystem APIs can target the workspace directory.
test('workspace write tool rejects an empty file path', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-empty-path-'));
  const tools = createWorkspaceToolService({ cwd });

  await assert.rejects(
    () => tools.execute('write_file', { content: 'hello' }),
    /requires a file path relative to the workspace/,
  );
});
// Recover the planned target when a local model omits write_file.path.
test('coding agent repairs a missing write path from the implementation plan', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-repair-path-'));
  let frontendTurns = 0;
  const service = createCodingAgentService({
    assistantService: {
      async generateReply(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];

        if (agent === 'planner') {
          return 'Create `chat_interface.html` in the workspace.';
        }

        return `${agent} requirements for chat_interface.html`;
      },
      async generateToolTurn(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];

        if (agent === 'testing' || agent === 'review') {
          return { role: 'assistant', content: agent === 'testing' ? 'Tested chat_interface.html.' : 'Verified chat_interface.html.' };
        }

        frontendTurns += 1;

        if (frontendTurns === 1) {
          return {
            role: 'assistant',
            content: '',
            tool_calls: [{
              function: {
                name: 'write_file',
                arguments: {
                  content: '<!doctype html><title>Recovered path</title>',
                },
              },
            }],
          };
        }

        return {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'finish_file', arguments: {} } }],
        };
      },
    },
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
    },
  });

  const result = await service.run('create chat_interface.html with a basic chat UI', { cwd });

  assert.equal(result.status, 'completed');
  assert.equal(frontendTurns, 2);
  assert.equal(
    await readFile(join(cwd, 'chat_interface.html'), 'utf8'),
    '<!doctype html><title>Recovered path</title>',
  );
});

// Accept common argument names emitted by different local tool-calling models.
test('workspace tools normalize MCP-style argument aliases', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-tool-alias-'));
  const tools = createWorkspaceToolService({ cwd });
  const args = tools.normalizeArguments('write_file', {
    file_path: 'nested/page.html',
    file_content: '<h1>Hello</h1>',
  });

  assert.deepEqual(args, {
    file_path: 'nested/page.html',
    file_content: '<h1>Hello</h1>',
    path: join('nested', 'page.html'),
    content: '<h1>Hello</h1>',
  });
});
// Report human-readable line counts for file writes.
test('workspace write tool reports written lines', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-line-count-'));
  const tools = createWorkspaceToolService({ cwd });
  const result = await tools.execute('write_file', {
    path: 'notes.txt',
    content: 'one\ntwo\nthree',
  });

  assert.equal(result, 'Wrote 3 lines to notes.txt.');
});

// Rerun the workflow when testing explicitly requests rework.
test('coding agent performs a bounded rework pass from testing feedback', async () => {
  const calls = [];
  let testingTurns = 0;
  const service = createCodingAgentService({
    assistantService: {
      async generateReply(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
        calls.push(agent);

        if (agent === 'testing') {
          testingTurns += 1;
          return testingTurns === 1 ? 'REWORK_REQUIRED: fix missing error handling.' : 'Tests passed.';
        }

        return `${agent} output`;
      },
    },
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
    },
  });

  const result = await service.run('build a backend service');

  assert.equal(result.status, 'completed');
  assert.equal(testingTurns, 2);
  assert.deepEqual(calls, [
    'planner', 'prd', 'backend', 'testing', 'review',
    'planner', 'prd', 'backend', 'testing', 'review',
  ]);
});

// Keep coding workflow warm-up disabled unless explicitly requested.
test('coding agent does not warm the model by default', async () => {
  const calls = [];
  const service = createCodingAgentService({
    assistantService: {
      async warmUp() {
        calls.push('warm');
      },
      async generateReply(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
        calls.push(agent);
        return `${agent} output`;
      },
    },
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      warmOnStart: false,
    },
  });

  await service.run('build a backend service');

  assert.deepEqual(calls, ['planner', 'prd', 'backend', 'testing', 'review']);
});

// Warm the configured model before planning a coding workflow when explicitly enabled.
test('coding agent warms the model before generating agent replies when enabled', async () => {
  const calls = [];
  const service = createCodingAgentService({
    assistantService: {
      async warmUp() {
        calls.push('warm');
      },
      async generateReply(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
        calls.push(agent);
        return `${agent} output`;
      },
    },
    modelConfig: {
      host: 'http://127.0.0.1:11434',
      model: 'test-model',
      warmOnStart: true,
    },
  });

  await service.run('build a backend service');

  assert.equal(calls[0], 'warm');
  assert.deepEqual(calls.slice(1), ['planner', 'prd', 'backend', 'testing', 'review']);
});
// Allow progressive chunks while blocking repeated chunks.
test('coding agent writes, appends, and finishes one file without duplicate chunks', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-chunked-write-'));
  let frontendTurns = 0;
  const events = [];
  const service = createCodingAgentService({
    assistantService: {
      async generateReply(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
        return agent === 'planner' ? 'Create `single.html`.' : `${agent} output for single.html`;
      },
      async generateToolTurn(messages) {
        const agent = messages[0].content.match(/You are the (\w+) agent/)?.[1];
        if (agent === 'testing' || agent === 'review') return { role: 'assistant', content: agent === 'testing' ? 'Tested single.html.' : 'Reviewed single.html.' };

        frontendTurns += 1;
        if (frontendTurns === 1) {
          return { role: 'assistant', content: '', tool_calls: [{ function: {
            name: 'write_file', arguments: { path: 'single.html', content: '<!doctype html>\n' },
          } }] };
        }
        if (frontendTurns === 2) {
          return { role: 'assistant', content: '', tool_calls: [{ function: {
            name: 'append_file', arguments: { path: 'single.html', content: '<title>Done</title>' },
          } }] };
        }
        return { role: 'assistant', content: '', tool_calls: [{ function: {
          name: 'finish_file', arguments: { path: 'single.html' },
        } }] };
      },
    },
    modelConfig: { host: 'http://127.0.0.1:11434', model: 'test-model' },
  });

  const result = await service.run('create single.html', { cwd, onEvent: (event) => events.push(event) });

  assert.equal(result.status, 'completed');
  assert.equal(frontendTurns, 3);
  assert.equal(await readFile(join(cwd, 'single.html'), 'utf8'), '<!doctype html>\n<title>Done</title>');
  assert.equal(events.filter((event) => event.type === 'tool.completed').length, 3);
  assert.match(result.results.get('frontend-task').output, /Wrote 1 lines.*Appended 1 lines/);
});



