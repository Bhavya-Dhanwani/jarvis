// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import Node's built-in test runner.
import test from 'node:test';
// Import the relay call dispatcher under test.
import { createHostRelayAgent, handleRelayCall } from '../src/services/hostRelayAgent.js';

// Verify the host relay agent connects out, dispatches an incoming call to the model, and
// streams token + result frames back (with prompt/streaming logging for the operator).
test('createHostRelayAgent dispatches a relay call and logs it', async () => {
  const sent = [];
  const logs = [];
  const handlers = {};

  class FakeWS {
    constructor() {
      this.OPEN = 1;
      this.readyState = 1;
    }

    on(event, cb) {
      (handlers[event] ??= []).push(cb);
      return this;
    }

    send(value) {
      sent.push(JSON.parse(value));
    }

    close() {}
  }

  const agent = createHostRelayAgent({
    signalingServerUrl: 'http://localhost:4000',
    getAccessToken: async () => 'token',
    ollamaService: {
      config: { model: 'qwen3:8b', models: { main: 'qwen3:8b', coding: 'qwen2.5-coder:7b', fast: 'qwen3:4b' } },
      async generateReply(_messages, { onToken }) {
        onToken('hi');
        return 'hi';
      },
    },
    WebSocketImpl: FakeWS,
    output: (level, title, detail) => logs.push({ title, detail }),
  });

  agent.start();

  // Wait for connect (async getAccessToken) to register handlers, then open the socket.
  for (let i = 0; i < 100 && !handlers.message; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  (handlers.open ?? []).forEach((cb) => cb());

  handlers.message.forEach((cb) => cb(Buffer.from(JSON.stringify({
    type: 'call',
    id: '1',
    method: 'generateReply',
    args: { device: 'macbook', messages: [{ role: 'user', content: 'explain hashmaps' }] },
  }))));

  for (let i = 0; i < 100 && !sent.find((f) => f.type === 'result'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  assert.ok(sent.find((f) => f.type === 'token' && f.chunk === 'hi'));
  assert.equal(sent.find((f) => f.type === 'result').value, 'hi');
  const prompt = logs.find((entry) => entry.title === 'Prompt received');
  assert.match(prompt.detail, /macbook/);
  assert.match(prompt.detail, /explain hashmaps/);

  // The streaming log names the model in use (no role → auto-routed by prompt length).
  const streaming = logs.find((entry) => entry.title === 'Streaming response');
  assert.match(streaming.detail, /answering using .+ model/);

  agent.stop();
});

// A capturing send() so we can inspect the frames the host would emit.
function createCapture() {
  const frames = [];
  return { frames, send: (value) => frames.push(value) };
}

test('handleRelayCall streams generateReply tokens then a result frame', async () => {
  const { frames, send } = createCapture();
  const ollamaService = {
    generateReply: async (messages, { onToken }) => {
      assert.deepEqual(messages, [{ role: 'user', content: 'hi' }]);
      onToken('He');
      onToken('llo');
      return 'Hello';
    },
  };

  await handleRelayCall({
    frame: { id: '7', method: 'generateReply', args: { messages: [{ role: 'user', content: 'hi' }] } },
    ollamaService,
    send,
  });

  assert.deepEqual(frames, [
    { type: 'token', id: '7', chunk: 'He' },
    { type: 'token', id: '7', chunk: 'llo' },
    { type: 'result', id: '7', value: 'Hello' },
  ]);
});

test('handleRelayCall forwards reasoning as thinking frames before the answer', async () => {
  const { frames, send } = createCapture();
  const ollamaService = {
    generateReply: async (_messages, { onToken, onThinking }) => {
      onThinking('reasoning ');
      onThinking('here');
      onToken('answer');
      return 'answer';
    },
  };

  await handleRelayCall({
    frame: { id: '11', method: 'generateReply', args: { messages: [] } },
    ollamaService,
    send,
  });

  assert.deepEqual(frames, [
    { type: 'thinking', id: '11', chunk: 'reasoning ' },
    { type: 'thinking', id: '11', chunk: 'here' },
    { type: 'token', id: '11', chunk: 'answer' },
    { type: 'result', id: '11', value: 'answer' },
  ]);
});

test('handleRelayCall returns the message for generateToolTurn', async () => {
  const { frames, send } = createCapture();
  const message = { role: 'assistant', content: '', tool_calls: [{ name: 'read' }] };
  const ollamaService = {
    generateToolTurn: async (_messages, { tools }) => {
      assert.deepEqual(tools, [{ name: 'read' }]);
      return message;
    },
  };

  await handleRelayCall({
    frame: { id: '8', method: 'generateToolTurn', args: { messages: [], tools: [{ name: 'read' }] } },
    ollamaService,
    send,
  });

  assert.deepEqual(frames, [{ type: 'result', id: '8', value: message }]);
});

test('handleRelayCall reports generation errors as an error frame', async () => {
  const { frames, send } = createCapture();
  const ollamaService = {
    generateReply: async () => {
      throw new Error('model exploded');
    },
  };

  await handleRelayCall({
    frame: { id: '9', method: 'generateReply', args: { messages: [] } },
    ollamaService,
    send,
  });

  assert.deepEqual(frames, [{ type: 'error', id: '9', message: 'model exploded' }]);
});

test('handleRelayCall rejects unknown methods', async () => {
  const { frames, send } = createCapture();

  await handleRelayCall({
    frame: { id: '10', method: 'nope', args: {} },
    ollamaService: {},
    send,
  });

  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, 'error');
  assert.match(frames[0].message, /Unknown relay method/);
});
