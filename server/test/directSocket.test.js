// End-to-end test of the direct transport: the client's RelayAssistantService connects
// straight to the host's socket server over real localhost WebSockets, with no signaling
// server anywhere in the data path.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostSocketServer, HOST_SOCKET_PATH } from '../src/services/hostSocketServer.js';
import { RelayAssistantService } from '../src/services/relayAssistantService.js';

test('client streams a reply directly from the host socket', async () => {
  const server = createHostSocketServer({
    key: 'abc',
    ollamaService: {
      async generateReply(_messages, { onToken, onThinking }) {
        onThinking('mulling it over');
        onToken('Direct ');
        onToken('answer.');
        return 'Direct answer.';
      },
    },
  });
  const { port } = await server.start();
  const directUrl = `ws://127.0.0.1:${port}${HOST_SOCKET_PATH}?key=abc`;

  const client = new RelayAssistantService({ directUrl });
  const tokens = [];
  const thinking = [];

  const reply = await client.generateReply(
    [{ role: 'user', content: 'explain something in detail for me please' }],
    { onToken: (chunk) => tokens.push(chunk), onThinking: (chunk) => thinking.push(chunk) },
  );

  assert.equal(reply, 'Direct answer.');
  assert.equal(tokens.join(''), 'Direct answer.');
  assert.equal(thinking.join(''), 'mulling it over');
  assert.equal(client.hostOnline, true);

  client.close();
  server.close();
});

test('a direct socket call writes a [flow] timing line to the log file', async () => {
  const logPath = join(mkdtempSync(join(tmpdir(), 'jarvis-flow-')), 'flow.log');
  const previous = process.env.JARVIS_FLOW_LOG;
  process.env.JARVIS_FLOW_LOG = logPath;

  const server = createHostSocketServer({
    key: 'abc',
    ollamaService: {
      async generateReply(_messages, { onToken }) {
        onToken('hi');
        return 'hi';
      },
    },
  });

  try {
    const { port } = await server.start();
    const client = new RelayAssistantService({ directUrl: `ws://127.0.0.1:${port}${HOST_SOCKET_PATH}?key=abc` });

    await client.generateReply([{ role: 'user', content: 'please tell me something interesting now' }], {
      onToken: () => {},
    });

    // Logging is fire-and-forget; wait briefly for the append to flush.
    for (let i = 0; i < 50 && !existsSync(logPath); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const contents = readFileSync(logPath, 'utf8');
    assert.match(contents, /\[flow\]/);
    assert.match(contents, /generateReply/);
    assert.match(contents, /total=\d+ms/);

    client.close();
  } finally {
    server.close();
    if (previous === undefined) {
      delete process.env.JARVIS_FLOW_LOG;
    } else {
      process.env.JARVIS_FLOW_LOG = previous;
    }
  }
});

test('client answers small talk locally without opening the host socket', async () => {
  let connectionAttempts = 0;
  const server = createHostSocketServer({
    key: 'abc',
    ollamaService: {
      async generateReply() {
        connectionAttempts += 1;
        return 'should not be called';
      },
    },
  });
  const { port } = await server.start();
  const client = new RelayAssistantService({ directUrl: `ws://127.0.0.1:${port}${HOST_SOCKET_PATH}?key=abc` });

  const reply = await client.generateReply([{ role: 'user', content: 'yo bro how are you ?' }], {
    onToken: () => {},
  });

  assert.match(reply, /\w/);
  assert.equal(connectionAttempts, 0);

  client.close();
  server.close();
});
