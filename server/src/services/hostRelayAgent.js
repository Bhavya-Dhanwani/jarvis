// Host-side relay agent: keeps a WebSocket open to the signaling server as the
// active host, runs the local OllamaService, and streams generated tokens back to
// whichever client issued each call. This replaces the public tunnel + publish loop.
import WebSocket from 'ws';
import { toRelayUrl } from './relayUrl.js';

// Dispatch a single relay "call" frame to the local assistant and emit response
// frames through `send`. Kept separate from the socket lifecycle so it is trivially
// testable with a mock OllamaService and a capturing `send`.
export async function handleRelayCall({ frame, ollamaService, send }) {
  const { id, method, args = {} } = frame ?? {};

  if (!id || !method) {
    return;
  }

  try {
    if (method === 'warmUp') {
      if (typeof ollamaService.warmUp === 'function') {
        await ollamaService.warmUp();
      }

      send({ type: 'result', id, value: { ok: true } });
      return;
    }

    if (method === 'generateReply') {
      const reply = await ollamaService.generateReply(args.messages ?? [], {
        onToken: (chunk) => send({ type: 'token', id, chunk }),
        onThinking: (chunk) => send({ type: 'thinking', id, chunk }),
        generationOptions: args.generationOptions ?? {},
        maxContinuations: args.maxContinuations ?? null,
      });

      send({ type: 'result', id, value: reply });
      return;
    }

    if (method === 'generateToolTurn') {
      const message = await ollamaService.generateToolTurn(args.messages ?? [], {
        tools: args.tools ?? [],
      });

      send({ type: 'result', id, value: message });
      return;
    }

    send({ type: 'error', id, message: `Unknown relay method: ${method}` });
  } catch (error) {
    send({ type: 'error', id, message: error?.message ?? 'Relay call failed on the host' });
  }
}

// Create a long-lived host relay agent. start() resolves only when stop() is called
// (e.g. on Ctrl+C), mirroring the previous keepHostPublisherOnline lifecycle.
export function createHostRelayAgent({
  signalingServerUrl,
  getAccessToken,
  ollamaService,
  output = () => {},
  WebSocketImpl = WebSocket,
  reconnectDelayMs = 3000,
  warm = null,
  warmIntervalMs = 30000,
}) {
  let socket = null;
  let stopped = false;
  let reconnectTimer = null;
  let warmTimer = null;
  let resolveStopped = null;

  const send = (value) => {
    if (socket && socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(value));
    }
  };

  async function connect() {
    if (stopped) {
      return;
    }

    let token;

    try {
      token = await getAccessToken();
    } catch (error) {
      output('warning', 'Relay auth failed', error.message ?? 'could not refresh token');
      scheduleReconnect();
      return;
    }

    const url = toRelayUrl(signalingServerUrl, { role: 'host', token });
    socket = new WebSocketImpl(url);

    socket.on('open', () => {
      // Flush each token frame immediately instead of letting Nagle batch them.
      socket._socket?.setNoDelay?.(true);
      output('success', 'Relay online', 'host connected; clients can reach this machine');
    });

    socket.on('message', (raw) => {
      const frame = parseJson(raw);

      if (frame?.type === 'call') {
        handleRelayCall({ frame, ollamaService, send });
      }
    });

    socket.on('close', () => {
      if (!stopped) {
        output('warning', 'Relay dropped', 'reconnecting...');
        scheduleReconnect();
      }
    });

    socket.on('error', () => {
      // 'close' fires after 'error'; reconnect is handled there.
    });
  }

  function scheduleReconnect() {
    if (stopped) {
      return;
    }

    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelayMs);
  }

  function startWarmLoop() {
    if (typeof warm !== 'function') {
      return;
    }

    const tick = async () => {
      if (stopped) {
        return;
      }

      await warm();
      warmTimer = setTimeout(tick, warmIntervalMs);
    };

    warmTimer = setTimeout(tick, warmIntervalMs);
  }

  function stop() {
    if (stopped) {
      return;
    }

    stopped = true;
    clearTimeout(reconnectTimer);
    clearTimeout(warmTimer);

    try {
      socket?.close?.();
    } catch {
      // Ignore errors closing a broken socket.
    }

    output('warning', 'Relay stopped', 'host link closed');
    resolveStopped?.();
  }

  function start() {
    startWarmLoop();
    connect();

    return new Promise((resolve) => {
      resolveStopped = resolve;
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  }

  return { start, stop };
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}
