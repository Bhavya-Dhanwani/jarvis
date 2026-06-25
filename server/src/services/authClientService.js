import { saveAuth } from './runtimeModeService.js';

export async function authenticateWithServer({ prompts, output, defaultServerUrl, dataRoot }) {
  const serverUrl = await prompts.ask('Auth/server URL', {
    defaultValue: defaultServerUrl,
    hint: 'Use the same signaling server URL on the host and client.',
  });
  const mode = await prompts.select('Authenticate with Jarvis server', [
    { title: 'Login', description: 'Use an existing Jarvis account.', value: 'login' },
    { title: 'Register', description: 'Create a new Jarvis account.', value: 'register' },
  ]);
  const email = await prompts.ask('Email');
  const password = await prompts.ask('Password');
  const name = mode === 'register'
    ? await prompts.ask('Name')
    : undefined;

  const payload = mode === 'register'
    ? { name, email, password }
    : { email, password };
  const response = await fetchJson(`${serverUrl.replace(/\/$/, '')}/api/auth/${mode}`, {
    method: 'POST',
    body: payload,
  });
  const tokens = normalizeTokens(response.data);

  if (!tokens.refreshToken) {
    throw new Error('Auth server did not return a refresh token.');
  }

  const authPath = await saveAuth({
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    user: response.data?.user,
    serverUrl,
    dataRoot,
  });

  output.write(`Saved protected auth token file: ${authPath}\n`);

  return {
    serverUrl,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: response.data?.user,
  };
}

export async function refreshAccessToken({ serverUrl, refreshToken }) {
  const response = await fetchJson(`${serverUrl.replace(/\/$/, '')}/api/auth/refresh`, {
    method: 'POST',
    body: { refreshToken },
  });

  return normalizeTokens(response.data).accessToken;
}

export async function publishOllamaUrl({ serverUrl, accessToken, ollamaUrl }) {
  return fetchJson(`${serverUrl.replace(/\/$/, '')}/api/ollama-url`, {
    method: 'POST',
    accessToken,
    body: { url: ollamaUrl },
  });
}

export async function claimOllamaUrl({ serverUrl, accessToken }) {
  return fetchJson(`${serverUrl.replace(/\/$/, '')}/api/ollama-url/claim`, {
    method: 'POST',
    accessToken,
  });
}

async function fetchJson(url, { method = 'GET', accessToken, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `Request failed: ${response.status} ${response.statusText}`);
  }

  return payload;
}

function normalizeTokens(data) {
  return {
    accessToken: data?.accessToken ?? data?.token,
    refreshToken: data?.refreshToken ?? data?.token,
  };
}
