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
  // Use a real question (not small talk) so the call actually crosses the relay; casual
  // greetings are now answered locally without a round trip.
  const replyPromise = service.generateReply([{ role: 'user', content: 'what is recursion' }], {
    onToken: (chunk) => tokens.push(chunk),
  });

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];
  assert.equal(call.type, 'call');
  assert.equal(call.method, 'generateReply');
  assert.deepEqual(call.args.messages, [{ role: 'user', content: 'what is recursion' }]);

  socket.receive({ type: 'token', id: call.id, chunk: 'Hi ' });
  socket.receive({ type: 'token', id: call.id, chunk: 'there' });
  socket.receive({ type: 'result', id: call.id, value: 'Hi there' });

  const reply = await replyPromise;
  assert.equal(reply, 'Hi there');
  assert.deepEqual(tokens, ['Hi ', 'there']);
  service.close();
});

test('generateReply answers casual greetings locally without touching the relay', async () => {
  const { service, sockets } = makeService();
  const tokens = [];

  const reply = await service.generateReply([{ role: 'user', content: 'yooo bro how are you ?' }], {
    onToken: (chunk) => tokens.push(chunk),
  });

  assert.match(reply, /\w/);
  assert.equal(tokens.join(''), reply);
  // No socket frame should have been sent for pure small talk.
  assert.equal(sockets[0]?.sent?.length ?? 0, 0);
  service.close();
});

test('generateReply strips inline think tags streamed by an out-of-date host', async () => {
  const { service, sockets } = makeService();
  const tokens = [];
  const thinking = [];
  const replyPromise = service.generateReply([{ role: 'user', content: 'who are you' }], {
    onToken: (chunk) => tokens.push(chunk),
    onThinking: (chunk) => thinking.push(chunk),
  });

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];

  // Host streams reasoning inline as <think> tokens (split across frames) then the answer.
  socket.receive({ type: 'token', id: call.id, chunk: '<think>just ' });
  socket.receive({ type: 'token', id: call.id, chunk: 'reasoning</think>I am ' });
  socket.receive({ type: 'token', id: call.id, chunk: 'Jarvis.' });
  socket.receive({ type: 'result', id: call.id, value: '<think>just reasoning</think>I am Jarvis.' });

  const reply = await replyPromise;
  assert.equal(reply, 'I am Jarvis.');
  assert.equal(tokens.join(''), 'I am Jarvis.');
  assert.equal(thinking.join(''), 'just reasoning');
  service.close();
});

test('generateReply forwards the model role to the host', async () => {
  const { service, sockets } = makeService();
  const replyPromise = service.generateReply([{ role: 'user', content: 'classify this request please' }], {
    onToken: () => {},
    role: 'fast',
  });

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];

  assert.equal(call.args.role, 'fast');

  socket.receive({ type: 'result', id: call.id, value: 'ok' });
  await replyPromise;
  service.close();
});

test('generateToolTurn forwards the coding role by default', async () => {
  const { service, sockets } = makeService();
  const turnPromise = service.generateToolTurn([{ role: 'user', content: 'edit a file' }], { tools: [] });

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];

  assert.equal(call.method, 'generateToolTurn');
  assert.equal(call.args.role, 'coding');

  socket.receive({ type: 'result', id: call.id, value: { role: 'assistant', content: 'done' } });
  await turnPromise;
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

test('thinking frames are delivered to onThinking, separate from the reply', async () => {
  const { service, sockets } = makeService();
  const thinking = [];
  const tokens = [];
  const replyPromise = service.generateReply([{ role: 'user', content: 'why' }], {
    onToken: (chunk) => tokens.push(chunk),
    onThinking: (chunk) => thinking.push(chunk),
  });

  const socket = await waitForSend(sockets);
  const call = socket.sent[0];

  socket.receive({ type: 'thinking', id: call.id, chunk: 'let me think' });
  socket.receive({ type: 'token', id: call.id, chunk: 'answer' });
  socket.receive({ type: 'result', id: call.id, value: 'answer' });

  assert.equal(await replyPromise, 'answer');
  assert.deepEqual(thinking, ['let me think']);
  assert.deepEqual(tokens, ['answer']);
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
