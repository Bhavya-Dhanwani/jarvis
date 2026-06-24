// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import temporary folder helpers.
import { mkdtempSync } from 'node:fs';
// Import the OS temporary folder.
import { tmpdir } from 'node:os';
// Import path helpers.
import { join, resolve } from 'node:path';
// Import streams to simulate CLI input and output.
import { Readable, Writable } from 'node:stream';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the CLI runner under test.
import { runCli } from '../src/cli/index.js';
// Import database initializer for isolated test databases.
import { createInitializedDatabase } from '../src/database/connection.js';
// Import workspace command service under test.
import { createWorkspaceCommandService } from '../src/services/workspaceCommandService.js';

// Verify chat slash commands use the folder where Jarvis was launched.
test('Jarvis chat runs coding, command, and Git push actions in the active workspace', async () => {
  const databasePath = join(mkdtempSync(join(tmpdir(), 'jarvis-workspace-')), 'jarvis.sqlite');
  const database = createInitializedDatabase(databasePath);
  const output = createOutputCapture();
  const calls = [];
  const workspace = 'D:\\projects\\example';
  const codingAgentService = {
    async run(request, { cwd, onEvent }) {
      calls.push({ type: 'code', request, cwd });
      onEvent({
        type: 'task.completed',
        task: {
          agent: 'review',
          title: 'Review completed work',
        },
      });

      return {
        status: 'completed',
        results: new Map([['review-task', {
          output: 'Coding work reviewed.',
        }]]),
      };
    },
  };
  const workspaceCommandService = {
    async run(command) {
      calls.push({ type: 'run', command });
      return {
        status: 'completed',
        exitCode: 0,
        stdout: 'tests passed',
        stderr: '',
      };
    },
    async gitPush(args) {
      calls.push({ type: 'push', args });
      return {
        status: 'completed',
        exitCode: 0,
        stdout: '',
        stderr: 'pushed',
      };
    },
  };

  try {
    await runCli([], {
      database,
      cwd: workspace,
      input: Readable.from([
        '/commands\n',
        '/code build the API\n',
        '/run npm test\n',
        '/git push origin main\n',
        '/exit\n',
      ]),
      outputStream: output.stream,
      output: output.writeLine,
      codingAgentService,
      workspaceCommandService,
      assistantService: {
        async generateReply() {
          throw new Error('Slash commands must not use normal chat replies.');
        },
      },
    });

    assert.deepEqual(calls, [
      {
        type: 'code',
        request: 'build the API',
        cwd: workspace,
      },
      {
        type: 'run',
        command: 'npm test',
      },
      {
        type: 'push',
        args: ['origin', 'main'],
      },
    ]);
    assert.match(output.text(), /JARVIS COMMANDS/);
    assert.match(output.text(), /Coding work reviewed/);
    assert.match(output.text(), /tests passed/);
    assert.match(output.text(), /pushed/);
  } finally {
    database.close();
  }
});

// Verify real commands execute in the configured workspace.
test('workspace command service runs commands in its fixed folder', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jarvis-command-'));
  const service = createWorkspaceCommandService({ cwd });
  const result = await service.run('node -p "process.cwd()"');

  assert.equal(result.status, 'completed');
  assert.equal(resolve(result.stdout), resolve(cwd));
});

// Verify generic commands cannot hide a Git push.
test('workspace command service requires the explicit Git push action', async () => {
  const service = createWorkspaceCommandService();

  await assert.rejects(
    () => service.run('git push origin main'),
    /Use \/git push/,
  );
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
