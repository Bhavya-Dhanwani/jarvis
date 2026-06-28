import WebSocket from 'ws';
import { toRelayUrl } from './relayUrl.js';

// Transport-agnostic dispatcher for one model "call" frame. Used by both the host's own
// WebSocket server (hostSocketServer.js) and the relay agent below: it runs the local
// OllamaService and emits token/thinking/result/error frames through `send`. Kept separate
// from any socket lifecycle so it is trivially testable with a mock OllamaService.
export async function handleRelayCall({ frame, ollamaService, send, log = null }) {
  const { id, method, args = {} } = frame ?? {};

  if (!id || !method) {
    return;
  }

  const startedAt = Date.now();
  let firstChunkAt = null;
  const markFirstChunk = () => {
    if (firstChunkAt === null) {
      firstChunkAt = Date.now();
    }
  };

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
        onToken: (chunk) => {
          markFirstChunk();
          send({ type: 'token', id, chunk });
        },
        onThinking: (chunk) => {
          markFirstChunk();
          send({ type: 'thinking', id, chunk });
        },
        generationOptions: args.generationOptions ?? {},
        maxContinuations: args.maxContinuations ?? null,
        // Honor the client's reasoning decision (the cheap intent router sends think:false).
        think: args.think ?? null,
        // Honor the client's model role so the host runs the right model (fast/coding/main).
        role: args.role ?? null,
      });

      send({ type: 'result', id, value: reply });

      if (typeof log === 'function') {
        const first = firstChunkAt ? `${((firstChunkAt - startedAt) / 1000).toFixed(1)}s` : '—';
        const total = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
        log(`host first chunk ${first} · host total ${total}`);
      }

      return;
    }

    if (method === 'generateToolTurn') {
      const message = await ollamaService.generateToolTurn(args.messages ?? [], {
        tools: args.tools ?? [],
        role: args.role ?? 'coding',
      });

      send({ type: 'result', id, value: message });
      return;
    }

    send({ type: 'error', id, message: `Unknown relay method: ${method}` });
  } catch (error) {
    send({ type: 'error', id, message: error?.message ?? 'Relay call failed on the host' });
  }
}

// Long-lived host relay agent: holds a WebSocket open to the signaling server as the active
// host, runs the local OllamaService, and streams generated frames back to whichever client
// issued each call. Both host and client connect OUT to the server, so no inbound tunnel is
// needed. start() resolves only when stop() is called (e.g. Ctrl+C).
export function createHostRelayAgent({
  signalingServerUrl,
  getAccessToken,
  ollamaService,
  output = () => {},
  WebSocketImpl = WebSocket,
  reconnectDelayMs = 3000,
  warm = null,
  warmIntervalMs = 600000,
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

  // Log the prompt and stream lifecycle for each call so the operator sees activity live.
  const dispatch = (frame) => {
    if (frame?.type !== 'call') {
      return;
    }

    const device = String(frame.args?.device ?? 'a client');
    const model = resolveModelLabel(ollamaService, frame.args?.role, frame.args?.messages);

    if (frame.method === 'generateReply' || frame.method === 'generateToolTurn') {
      const roleTag = frame.args?.role ? ` [${frame.args.role}]` : '';
      output('info', 'Prompt received', `${device}${roleTag} → ${truncate(latestPrompt(frame.args?.messages), 100)}`);
    } else {
      output('info', 'Request received', `${device} → ${frame.method}`);
    }

    let streamingLogged = false;
    const loggingSend = (value) => {
      if (!streamingLogged && (value.type === 'token' || value.type === 'thinking')) {
        streamingLogged = true;
        const verb = value.type === 'thinking' ? 'reasoning' : 'answering';
        output('info', 'Streaming response', `${device} → ${verb} using ${model} model`);
      }

      if (value.type === 'result') {
        output('success', 'Response sent', `${device} (${model})`);
      }

      send(value);
    };

    handleRelayCall({ frame, ollamaService, send: loggingSend });
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
      socket._socket?.setNoDelay?.(true);
      output('success', 'Relay online', 'host connected; clients can reach this machine');
    });

    socket.on('message', (raw) => {
      const frame = parseJson(raw);
      if (frame) {
        dispatch(frame);
      }
    });

    socket.on('close', () => {
      if (!stopped) {
        output('warning', 'Relay dropped', 'reconnecting…');
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

// Resolve which model the host will run for this call, for the operator log. An explicit
// role maps to that role's model; chat (no role) auto-routes short prompts to the fast
// model and longer ones to main, mirroring OllamaService's own routing.
function resolveModelLabel(ollamaService, role, messages) {
  const models = ollamaService?.config?.models ?? {};
  const fallback = ollamaService?.config?.model ?? 'model';

  if (role) {
    return models[role] ?? fallback;
  }

  const latest = Array.isArray(messages)
    ? [...messages].reverse().find((message) => message?.role === 'user')?.content ?? ''
    : '';
  const words = String(latest).trim().split(/\s+/).filter(Boolean).length;
  const autoRole = words >= 8 ? 'main' : 'fast';
  return models[autoRole] ?? models.main ?? fallback;
}

function latestPrompt(messages) {
  if (!Array.isArray(messages)) {
    return '(no prompt)';
  }

  const latest = [...messages].reverse().find((message) => message?.role === 'user');
  return String(latest?.content ?? '(no prompt)').replace(/\s+/g, ' ').trim() || '(empty prompt)';
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}
