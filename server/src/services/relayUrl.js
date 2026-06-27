// Derive the relay WebSocket URL from the signaling server's HTTP URL.
// e.g. https://jarvis.example.com -> wss://jarvis.example.com/relay
//      http://localhost:4000      -> ws://localhost:4000/relay
export function toRelayUrl(signalingServerUrl, { role, token } = {}) {
  const base = new URL(signalingServerUrl);
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  base.pathname = '/relay';
  base.search = '';

  if (role) {
    base.searchParams.set('role', role);
  }

  if (token) {
    base.searchParams.set('token', token);
  }

  return base.toString();
}
