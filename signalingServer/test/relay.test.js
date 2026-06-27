// Integration test for the host<->client WebSocket relay using real sockets.
import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import jwt from "jsonwebtoken";
import { WebSocket } from "ws";
import env from "../src/shared/config/env.config.js";
import { attachRelay, __resetRelayState } from "../src/relay/relay.js";

// Start an HTTP server with the relay attached and return its base ws URL + closer.
async function startRelayServer() {
  __resetRelayState();
  const server = createServer();
  attachRelay(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `ws://127.0.0.1:${port}/relay`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function token(userId = "user-1") {
  return jwt.sign({ id: userId }, env.JWT_SECRET, { expiresIn: "5m" });
}

// Wrap a socket with a frame buffer so no message is missed between the open
// handshake and the first read (the relay sends host-status immediately on connect).
function openFramed(baseUrl, role) {
  const socket = new WebSocket(`${baseUrl}?role=${role}&token=${token()}`);
  const queue = [];
  const waiters = [];

  socket.on("message", (raw) => {
    const frame = JSON.parse(raw.toString());
    const waiter = waiters.shift();

    if (waiter) {
      waiter(frame);
    } else {
      queue.push(frame);
    }
  });

  return {
    socket,
    send: (value) => socket.send(JSON.stringify(value)),
    next: () => (queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((resolve) => waiters.push(resolve))),
  };
}

test("relay routes a client call to the host and streams the reply back", async () => {
  const server = await startRelayServer();

  try {
    const host = openFramed(server.url, "host");
    await once(host.socket, "open");

    const client = openFramed(server.url, "client");
    await once(client.socket, "open");

    // First client frame is the host-status broadcast.
    assert.deepEqual(await client.next(), { type: "host-status", online: true });

    // Host echoes a streamed reply for any call it receives.
    host.socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === "call") {
        host.send({ type: "token", id: frame.id, chunk: "hello" });
        host.send({ type: "result", id: frame.id, value: "hello world" });
      }
    });

    client.send({
      type: "call",
      id: "abc",
      method: "generateReply",
      args: { messages: [{ role: "user", content: "hi" }] },
    });

    assert.deepEqual(await client.next(), { type: "token", id: "abc", chunk: "hello" });
    assert.deepEqual(await client.next(), { type: "result", id: "abc", value: "hello world" });

    host.socket.close();
    client.socket.close();
  } finally {
    await server.close();
  }
});

test("relay tells the client there is no host when one calls before a host connects", async () => {
  const server = await startRelayServer();

  try {
    const client = openFramed(server.url, "client");
    await once(client.socket, "open");

    assert.deepEqual(await client.next(), { type: "host-status", online: false });

    client.send({ type: "call", id: "x1", method: "warmUp", args: {} });
    const frame = await client.next();
    assert.equal(frame.type, "error");
    assert.match(frame.message, /No host/);

    client.socket.close();
  } finally {
    await server.close();
  }
});

test("relay rejects a connection without a valid token", async () => {
  const server = await startRelayServer();

  try {
    const socket = new WebSocket(`${server.url}?role=client`);
    const [code] = await once(socket, "close");
    assert.equal(code, 4401);
  } finally {
    await server.close();
  }
});
