// Client-side assistant that speaks the relay protocol instead of calling Ollama
// over HTTP. It implements the same interface ChatService / ChatLoopService /
// codingAgentService expect (warmUp, generateReply, generateToolTurn), but every
// call travels over one WebSocket to the signaling server, which forwards it to the
// host. Tokens stream back in real-time through onToken.
import { hostname } from 'node:os';
import WebSocket from 'ws';
import { toRelayUrl } from './relayUrl.js';
import { createLocalFastReply, createThinkTagRouter, stripThinkTags } from './ollamaService.js';
import { logFlow } from './flowLogger.js';

// Bound each WebSocket handshake so a stuck tunnel upgrade can't hang the client.
const CONNECT_TIMEOUT_MS = 8000;

// This machine's name, announced to the host so it can log which device connected.
function deviceName() {
  try {
    return hostname() || 'jarvis-client';
  } catch {
    return 'jarvis-client';
  }
}

// Options for the `ws` client: a handshake timeout, a device header the host logs, plus
// headers that get past tunnel interstitials (localtunnel's reminder page blocks plain
// upgrades without these). Injected fake sockets in tests simply ignore the second arg.
function socketConnectOptions(url) {
  const headers = {
    'x-jarvis-device': deviceName(),
    'User-Agent': 'jarvis-client',
  };

  try {
    const { hostname: host } = new URL(url);

    if (host.endsWith('.loca.lt') || host.endsWith('.trycloudflare.com') || host.endsWith('.ngrok-free.app')) {
      headers['bypass-tunnel-reminder'] = 'true';
    }
  } catch {
    // Non-URL (tests): the device header is still fine to send.
  }

  return { handshakeTimeout: CONNECT_TIMEOUT_MS, headers };
}

export class RelayAssistantService {
  #signalingServerUrl;
  #getAccessToken;
  #WebSocketImpl;
  #socket = null;
  #connecting = null;
  #nextId = 1;
  #pending = new Map();
  #hostOnline = false;
  #hostWaiters = new Set();

  #directUrl;

  constructor({ signalingServerUrl, getAccessToken, WebSocketImpl = WebSocket, directUrl = null }) {
    this.#signalingServerUrl = signalingServerUrl;
    this.#getAccessToken = getAccessToken;
    this.#WebSocketImpl = WebSocketImpl;
    // When set, connect straight to the host's own socket (no signaling relay in the
    // data path). The URL already carries the ?key= capability from the claim.
    this.#directUrl = directUrl;
  }

  get hostOnline() {
    return this.#hostOnline;
  }

  // Open the WebSocket without issuing a call, so host-status frames start arriving.
  async connect() {
    await this.#ensureSocket();
  }

  async warmUp() {
    await this.#call('warmUp', {});
  }

  async generateReply(messages, { onToken = null, onThinking = null, generationOptions = {}, maxContinuations = null, think = null, role = null } = {}) {
    // Answer casual small talk locally so greetings never cross the relay (instant, and
    // immune to a slow or out-of-date host).
    const localReply = createLocalFastReply(messages);

    if (localReply) {
      if (typeof onToken === 'function') {
        onToken(localReply);
      }

      return localReply;
    }

    // Even if the host streams chain-of-thought inline as <think>...</think> tokens (an
    // out-of-date host), route it to the dimmed thinking channel and keep it out of the
    // answer here on the client. An up-to-date host already sends clean tokens, so this
    // is a transparent safety net.
    const router = createThinkTagRouter({
      onAnswer: (text) => {
        if (typeof onToken === 'function') {
          onToken(text);
        }
      },
      onThink: (text) => {
        if (typeof onThinking === 'function') {
          onThinking(text);
        }
      },
    });

    const reply = await this.#call('generateReply', {
      messages,
      generationOptions,
      maxContinuations,
      think,
      role,
    }, {
      onToken: (chunk) => router.push(chunk),
      onThinking,
    });

    router.flush();

    return stripThinkTags(typeof reply === 'string' ? reply : '');
  }

  async generateToolTurn(messages, { tools = [], role = 'coding' } = {}) {
    return this.#call('generateToolTurn', { messages, tools, role });
  }

  // Resolve once a host is connected to the relay, or reject after timeoutMs.
  waitForHost(timeoutMs = 0) {
    if (this.#hostOnline) {
      return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, timer: null };

      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.#hostWaiters.delete(waiter);
          reject(new Error('No host connected to the relay yet.'));
        }, timeoutMs);
      }

      this.#hostWaiters.add(waiter);
    });
  }

  close() {
    try {
      this.#socket?.close?.();
    } catch {
      // Ignore errors closing a broken socket.
    }
  }

  async #call(method, args, { onToken = null, onThinking = null } = {}) {
    await this.#ensureSocket();

    const id = String(this.#nextId++);

    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        resolve,
        reject,
        onToken,
        onThinking,
        // Timing markers for the flow log: when sent, when the first chunk/answer
        // arrived, and how many token chunks streamed.
        method,
        sentAt: Date.now(),
        firstChunkAt: null,
        firstTokenAt: null,
        chunks: 0,
      });
      this.#send({ type: 'call', id, method, args });
    });
  }

  #send(value) {
    if (this.#socket && this.#socket.readyState === this.#socket.OPEN) {
      this.#socket.send(JSON.stringify(value));
    }
  }

  async #ensureSocket() {
    if (this.#socket && this.#socket.readyState === this.#socket.OPEN) {
      return;
    }

    if (this.#connecting) {
      return this.#connecting;
    }

    this.#connecting = this.#connectWithRetry();

    try {
      await this.#connecting;
    } finally {
      this.#connecting = null;
    }
  }

  // Open the socket, retrying transient handshake failures (e.g. a tunnel returning 408
  // before the host is ready). Without this, a single cold-start hiccup made warm-up and
  // the first message fail outright.
  async #connectWithRetry(attempts = 3) {
    // Direct mode: connect to the host's published socket URL (key already embedded).
    // Legacy relay mode: derive the signaling server's /relay URL with an auth token.
    const url = this.#directUrl
      ?? toRelayUrl(this.#signalingServerUrl, { role: 'client', token: await this.#getAccessToken() });
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.#openSocket(url);
        return;
      } catch (error) {
        lastError = error;
        this.#socket = null;

        if (attempt < attempts - 1) {
          await delay(400 * (attempt + 1));
        }
      }
    }

    throw lastError ?? new Error('Could not connect to the host socket.');
  }

  #openSocket(url) {
    return new Promise((resolve, reject) => {
      const socket = new this.#WebSocketImpl(url, socketConnectOptions(url));
      this.#socket = socket;
      let settled = false;

      // Never let a half-open handshake hang the client forever (a tunnel can accept the
      // TCP connection but stall the WebSocket upgrade). Reject after a bound so the retry
      // loop can try again or surface a clear error instead of "fetching" indefinitely.
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        try {
          (socket.terminate ?? socket.close)?.call(socket);
        } catch {
          // Ignore errors tearing down a stuck socket.
        }
        reject(new Error('Timed out connecting to the host socket.'));
      }, CONNECT_TIMEOUT_MS);

      socket.on('message', (raw) => this.#handleMessage(raw));
      socket.on('close', () => this.#handleClose());

      socket.on('open', () => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);
        // Flush frames immediately so streamed tokens arrive without Nagle batching.
        socket._socket?.setNoDelay?.(true);
        // In direct mode the connected host IS the host — there is no host-status frame,
        // so mark it online on connect.
        if (this.#directUrl) {
          this.#setHostOnline(true);
        }
        resolve();
      });

      socket.on('error', (error) => {
        // Only the handshake failure rejects the connect; later errors are handled by
        // 'close' so they don't double-settle this promise.
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  #handleMessage(raw) {
    const frame = parseJson(raw);

    if (!frame || !frame.type) {
      return;
    }

    if (frame.type === 'host-status') {
      this.#setHostOnline(Boolean(frame.online));
      return;
    }

    const entry = frame.id ? this.#pending.get(frame.id) : null;

    if (!entry) {
      return;
    }

    if (frame.type === 'thinking') {
      if (entry.firstChunkAt === null) {
        entry.firstChunkAt = Date.now();
      }

      if (typeof entry.onThinking === 'function' && frame.chunk) {
        entry.onThinking(frame.chunk);
      }
      return;
    }

    if (frame.type === 'token') {
      const now = Date.now();
      if (entry.firstChunkAt === null) {
        entry.firstChunkAt = now;
      }
      if (entry.firstTokenAt === null) {
        entry.firstTokenAt = now;
      }
      entry.chunks += 1;

      if (typeof entry.onToken === 'function' && frame.chunk) {
        entry.onToken(frame.chunk);
      }
      return;
    }

    if (frame.type === 'result') {
      this.#pending.delete(frame.id);
      logFlow({ ...entry, id: frame.id, doneAt: Date.now() });
      entry.resolve(frame.value);
      return;
    }

    if (frame.type === 'error') {
      this.#pending.delete(frame.id);
      logFlow({ ...entry, id: frame.id, doneAt: Date.now(), error: frame.message ?? 'error' });
      entry.reject(new Error(frame.message ?? 'Relay request failed'));
    }
  }

  #handleClose() {
    const error = new Error('Relay connection closed before the response completed.');

    for (const [id, entry] of this.#pending) {
      logFlow({ ...entry, id, doneAt: Date.now(), error: 'connection closed' });
      entry.reject(error);
    }

    this.#pending.clear();
    this.#socket = null;
    this.#setHostOnline(false);
  }

  #setHostOnline(online) {
    this.#hostOnline = online;

    if (online) {
      for (const waiter of this.#hostWaiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(true);
      }

      this.#hostWaiters.clear();
    }
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
