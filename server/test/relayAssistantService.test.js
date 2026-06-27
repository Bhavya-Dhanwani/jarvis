// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the client relay assistant under test.
import { RelayAssistantService } from '../src/services/relayAssistantService.js';

// Minimal stand-in for a `ws` WebSocket: records sent frames and lets the test push
// incoming frames. Auto-opens on the next microtask like a real connection would.
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.OPEN = 1;
    this.readyState = 0;
    this.sent = [];
    this.handlers = {};
    queueMicrotask(() => {
      this.readyState = this.OPEN;
      this.emit('open');
    });
  }

  on(event, cb) {
    (this.handlers[event] ??= []).push(cb);
    return this;
  }

  emit(event, ...args) {
    for (const cb of this.handlers[event] ?? []) {
      cb(...args);
    }
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }

  // Test helper: deliver a server frame to the client.
  receive(frame) {
    this.emit('message', Buffer.from(JSON.stringify(frame)));
  }
}

// Each call gets its own service + an array capturing the sockets it opens, so tests
// never share state through a static.
function makeService() {
  const sockets = [];

  class TestSocket extends FakeSocket {
    constructor(url) {
      super(url);
      sockets.push(this);
    }
  }

  const service = new RelayAssistantService({
    signalingServerUrl: 'http://localhost:4000',
    getAccessToken: async () => 'access-token',
    WebSocketImpl: TestSocket,
  });

  return { service, sockets };
}

// Wait until the service has opened a socket and sent its first frame.
async function waitForSend(sockets) {
  for (let i = 0; i < 50 && (!sockets[0] || sockets[0].sent.length === 0); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  return sockets[0];
}

test('generateReply streams tokens through onToken and resolves on result', async () => {
  const { service, sockets } = makeService();
  const tokens = [];
  const replyPromise = service.generateReply([{ role: 'user', content: 'hey' }], {
    onToken: (chunk) => tokens.push(chunk),
  });

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];
  assert.equal(call.type, 'call');
  assert.equal(call.method, 'generateReply');
  assert.deepEqual(call.args.messages, [{ role: 'user', content: 'hey' }]);

  socket.receive({ type: 'token', id: call.id, chunk: 'Hi ' });
  socket.receive({ type: 'token', id: call.id, chunk: 'there' });
  socket.receive({ type: 'result', id: call.id, value: 'Hi there' });

  const reply = await replyPromise;
  assert.equal(reply, 'Hi there');
  assert.deepEqual(tokens, ['Hi ', 'there']);
  service.close();
});

test('generateToolTurn resolves with the host message', async () => {
  const { service, sockets } = makeService();
  const message = { role: 'assistant', content: '', tool_calls: [{ name: 'write' }] };
  const turnPromise = service.generateToolTurn([{ role: 'user', content: 'do it' }], {
    tools: [{ name: 'write' }],
  });

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];
  assert.equal(call.method, 'generateToolTurn');

  socket.receive({ type: 'result', id: call.id, value: message });

  assert.deepEqual(await turnPromise, message);
  service.close();
});

test('an error frame rejects the pending call', async () => {
  const { service, sockets } = makeService();
  const promise = service.generateReply([{ role: 'user', content: 'x' }]);

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];
  socket.receive({ type: 'error', id: call.id, message: 'No host is online' });

  await assert.rejects(promise, /No host is online/);
  service.close();
});

test('host-status frames drive waitForHost and hostOnline', async () => {
  const { service, sockets } = makeService();
  await service.connect();

  assert.equal(service.hostOnline, false);

  const socket = sockets[0];
  const waiting = service.waitForHost(0);
  socket.receive({ type: 'host-status', online: true });

  await waiting;
  assert.equal(service.hostOnline, true);
  service.close();
});
