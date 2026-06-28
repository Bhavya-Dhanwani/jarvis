// Host-side WebSocket SERVER. Instead of the host connecting out to the signaling
// server's /relay, the host runs its own socket server that clients connect to
// DIRECTLY (the signaling server is used only to publish/exchange this socket's URL).
//
// The frame protocol is identical to the old relay: clients send {type:'call'} frames
// and receive {type:'token'|'thinking'|'result'|'error'} frames. Each client connection
// is independent and dispatches through the shared, transport-agnostic handleRelayCall.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { handleRelayCall } from './hostRelayAgent.js';

// Path the client connects to: wss://<tunnel-host>/socket?key=<key>.
export const HOST_SOCKET_PATH = '/socket';

// Build the public socket URL a client should connect to from a published tunnel URL.
export function composeHostSocketUrl(tunnelUrl, key) {
  const url = new URL(tunnelUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = HOST_SOCKET_PATH;
  url.search = '';

  if (key) {
    url.searchParams.set('key', key);
  }

  return url.toString();
}

// Create (but do not start) the host socket server. `key` gates every connection; a
// fresh random one is generated when not supplied. `ollamaService` runs the model.
export function createHostSocketServer({
  ollamaService,
  key = randomBytes(16).toString('hex'),
  host = '127.0.0.1',
  port = 0,
  output = () => {},
  WebSocketServerImpl = WebSocketServer,
} = {}) {
  if (!ollamaService) {
    throw new Error('createHostSocketServer requires an ollamaService.');
  }

  const httpServer = createServer((_req, res) => {
    // Plain HTTP probes (e.g. the tunnel's routing check) get a simple 200.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('jarvis-host');
  });

  const wss = new WebSocketServerImpl({ server: httpServer, path: HOST_SOCKET_PATH });

  wss.on('connection', (socket, request) => {
    if (!isAuthorized(request, key)) {
      try {
        socket.close(4401, 'Invalid or missing key');
      } catch {
        // Ignore errors closing an already-broken socket.
      }
      return;
    }

    // Flush each token frame immediately instead of letting Nagle batch them.
    socket._socket?.setNoDelay?.(true);

    const send = (value) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(value));
      }
    };

    socket.on('message', (raw) => {
      const frame = parseJson(raw);

      if (frame?.type === 'call') {
        // Each call streams its own token/result frames back on this same socket.
        handleRelayCall({ frame, ollamaService, send });
      }
    });
  });

  return {
    key,

    // Start listening; resolves with the bound { port, key }.
    start() {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.removeListener('error', reject);
          const bound = httpServer.address();
          const boundPort = typeof bound === 'object' && bound ? bound.port : port;
          output('success', 'Host socket', `listening on ${host}:${boundPort}${HOST_SOCKET_PATH}`);
          resolve({ port: boundPort, key });
        });
      });
    },

    // Local URL the tunnel should point at.
    localUrl() {
      const bound = httpServer.address();
      const boundPort = typeof bound === 'object' && bound ? bound.port : port;
      return `http://${host}:${boundPort}`;
    },

    close() {
      try {
        wss.close();
      } catch {
        // Ignore errors closing the WebSocket server.
      }

      try {
        httpServer.close();
      } catch {
        // Ignore errors closing the HTTP server.
      }
    },
  };
}

// A connection is authorized when its ?key= matches the host's session key.
function isAuthorized(request, key) {
  try {
    const url = new URL(request.url ?? '', 'http://127.0.0.1');
    return url.searchParams.get('key') === key;
  } catch {
    return false;
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}
