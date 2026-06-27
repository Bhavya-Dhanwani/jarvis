// Client-side assistant that speaks the relay protocol instead of calling Ollama
// over HTTP. It implements the same interface ChatService / ChatLoopService /
// codingAgentService expect (warmUp, generateReply, generateToolTurn), but every
// call travels over one WebSocket to the signaling server, which forwards it to the
// host. Tokens stream back in real-time through onToken.
import WebSocket from 'ws';
import { toRelayUrl } from './relayUrl.js';

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

  constructor({ signalingServerUrl, getAccessToken, WebSocketImpl = WebSocket }) {
    this.#signalingServerUrl = signalingServerUrl;
    this.#getAccessToken = getAccessToken;
    this.#WebSocketImpl = WebSocketImpl;
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

  async generateReply(messages, { onToken = null, generationOptions = {}, maxContinuations = null } = {}) {
    const reply = await this.#call('generateReply', {
      messages,
      generationOptions,
      maxContinuations,
    }, onToken);

    return typeof reply === 'string' ? reply : '';
  }

  async generateToolTurn(messages, { tools = [] } = {}) {
    return this.#call('generateToolTurn', { messages, tools });
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

  async #call(method, args, onToken = null) {
    await this.#ensureSocket();

    const id = String(this.#nextId++);

    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onToken });
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

    this.#connecting = (async () => {
      const token = await this.#getAccessToken();
      const url = toRelayUrl(this.#signalingServerUrl, { role: 'client', token });
      const socket = new this.#WebSocketImpl(url);
      this.#socket = socket;

      socket.on('message', (raw) => this.#handleMessage(raw));
      socket.on('close', () => this.#handleClose());
      socket.on('error', () => {
        // 'close' handles cleanup.
      });

      await new Promise((resolve, reject) => {
        socket.on('open', resolve);
        socket.on('error', reject);
      });
    })();

    try {
      await this.#connecting;
    } finally {
      this.#connecting = null;
    }
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

    if (frame.type === 'token') {
      if (typeof entry.onToken === 'function' && frame.chunk) {
        entry.onToken(frame.chunk);
      }
      return;
    }

    if (frame.type === 'result') {
      this.#pending.delete(frame.id);
      entry.resolve(frame.value);
      return;
    }

    if (frame.type === 'error') {
      this.#pending.delete(frame.id);
      entry.reject(new Error(frame.message ?? 'Relay request failed'));
    }
  }

  #handleClose() {
    const error = new Error('Relay connection closed before the response completed.');

    for (const [, entry] of this.#pending) {
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
