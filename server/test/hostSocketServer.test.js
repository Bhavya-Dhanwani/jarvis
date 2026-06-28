// Tests for the host's own WebSocket server: a key-gated socket that clients connect to
// directly (the signaling server is no longer in the data path).
import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createHostSocketServer, composeHostSocketUrl, HOST_SOCKET_PATH } from '../src/services/hostSocketServer.js';

function fakeOllamaService() {
  return {
    async generateReply(_messages, { onToken, onThinking }) {
      if (typeof onThinking === 'function') {
        onThinking('reasoning');
      }

      onToken('Hello ');
      onToken('world');
      return 'Hello world';
    },
  };
}

test('host socket server streams a reply to a client with the correct key', async () => {
  const server = createHostSocketServer({ ollamaService: fakeOllamaService(), key: 'secret' });
  const { port } = await server.start();
  const socket = new WebSocket(`ws://127.0.0.1:${port}${HOST_SOCKET_PATH}?key=secret`);

  const tokens = [];
  const thinking = [];
  let result = null;

  await new Promise((resolve, reject) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'call',
        id: '1',
        method: 'generateReply',
        args: { messages: [{ role: 'user', content: 'please explain something' }] },
      }));
    });
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === 'thinking') thinking.push(frame.chunk);
      if (frame.type === 'token') tokens.push(frame.chunk);
      if (frame.type === 'result') { result = frame.value; resolve(); }
      if (frame.type === 'error') reject(new Error(frame.message));
    });
    socket.on('error', reject);
  });

  assert.deepEqual(tokens, ['Hello ', 'world']);
  assert.deepEqual(thinking, ['reasoning']);
  assert.equal(result, 'Hello world');

  socket.close();
  server.close();
});

test('host socket server logs device, prompt, and streaming in real time', async () => {
  const logs = [];
  const server = createHostSocketServer({
    ollamaService: fakeOllamaService(),
    key: 'secret',
    output: (level, title, detail) => logs.push({ title, detail }),
  });
  const { port } = await server.start();
  const socket = new WebSocket(`ws://127.0.0.1:${port}${HOST_SOCKET_PATH}?key=secret`, {
    headers: { 'x-jarvis-device': 'macbook-pro' },
  });

  await new Promise((resolve, reject) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        type: 'call',
        id: '1',
        method: 'generateReply',
        args: { messages: [{ role: 'user', content: 'explain hashmaps please' }] },
      }));
    });
    socket.on('message', (raw) => {
      if (JSON.parse(raw.toString()).type === 'result') resolve();
    });
    socket.on('error', reject);
  });

  const titles = logs.map((entry) => entry.title);
  assert.ok(titles.includes('Device connected'));
  assert.ok(titles.includes('Prompt received'));
  assert.ok(titles.includes('Streaming response'));
  assert.ok(titles.includes('Response sent'));

  // The connect + prompt logs name the device, and the prompt text is shown.
  const connected = logs.find((entry) => entry.title === 'Device connected');
  assert.match(connected.detail, /macbook-pro/);
  const prompt = logs.find((entry) => entry.title === 'Prompt received');
  assert.match(prompt.detail, /explain hashmaps please/);

  socket.close();
  server.close();
});

test('host socket server rejects a connection with a wrong key', async () => {
  const server = createHostSocketServer({ ollamaService: fakeOllamaService(), key: 'secret' });
  const { port } = await server.start();
  const socket = new WebSocket(`ws://127.0.0.1:${port}${HOST_SOCKET_PATH}?key=wrong`);

  const closeCode = await new Promise((resolve) => {
    socket.on('close', (code) => resolve(code));
    socket.on('error', () => {});
  });

  assert.equal(closeCode, 4401);
  server.close();
});

test('composeHostSocketUrl builds a wss /socket url carrying the key', () => {
  assert.equal(
    composeHostSocketUrl('https://abc123.trycloudflare.com', 'k1'),
    'wss://abc123.trycloudflare.com/socket?key=k1',
  );
});

test('host socket server answers a plain HTTP probe with jarvis-host', async () => {
  const server = createHostSocketServer({ ollamaService: fakeOllamaService(), key: 'k' });
  const { port } = await server.start();

  const response = await fetch(`http://127.0.0.1:${port}/`);
  const body = await response.text();

  assert.equal(response.ok, true);
  assert.match(body, /jarvis-host/);
  server.close();
});
