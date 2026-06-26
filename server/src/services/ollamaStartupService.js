import { spawn } from 'node:child_process';

const DEFAULT_START_TIMEOUT_MS = 8000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export async function ensureOllamaReady({
  modelConfig,
  startServer = startOllamaServer,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_START_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  allowLocalStart = isLocalOllamaHost(modelConfig?.host),
} = {}) {
  if (!modelConfig?.host || !modelConfig?.model) {
    return missingSetup('Ollama model configuration is missing.');
  }

  const initial = await fetchOllamaTags(modelConfig.host, { fetchImpl });

  if (!initial.available) {
    if (!allowLocalStart) {
      return missingSetup(`Remote Ollama host is not reachable: ${modelConfig.host}`, {
        remote: true,
        host: modelConfig.host,
      });
    }

    const started = await startServer();

    if (!started.started) {
      return missingSetup('Ollama is not running and Jarvis could not start it.');
    }

    const afterStart = await waitForOllama(modelConfig.host, {
      fetchImpl,
      timeoutMs,
      pollIntervalMs,
    });

    if (!afterStart.available) {
      return missingSetup('Ollama did not become reachable after Jarvis tried to start it.');
    }

    return checkModel(afterStart.models, modelConfig.model);
  }

  return checkModel(initial.models, modelConfig.model);
}

export function formatOllamaSetupRequired(result, modelConfig) {
  const reason = result?.reason ?? 'Ollama is not ready.';

  if (result?.remote) {
    return [
      `${reason}`,
      '',
      'On the host device, run:',
      '  jarvis',
      '',
      'That keeps the tunnel published for this client.',
      '',
      `Configured remote host: ${modelConfig?.host ?? 'not configured'}`,
      `Configured model: ${modelConfig?.model ?? 'not configured'}`,
    ].join('\n');
  }

  return [
    `${reason}`,
    '',
    'Run setup to install/start Ollama and pull the selected model:',
    '  jarvis setup',
    '',
    `Configured model: ${modelConfig?.model ?? 'not configured'}`,
  ].join('\n');
}

async function fetchOllamaTags(host, { fetchImpl }) {
  try {
    const response = await fetchImpl(`${host}/api/tags`, {
      headers: createOllamaFetchHeaders(host),
    });

    if (!response.ok) {
      return {
        available: false,
        models: [],
      };
    }

    const payload = await response.json();

    return {
      available: true,
      models: Array.isArray(payload.models) ? payload.models : [],
    };
  } catch (error) {
    return {
      available: false,
      models: [],
      error,
    };
  }
}

async function waitForOllama(host, { fetchImpl, timeoutMs, pollIntervalMs }) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const result = await fetchOllamaTags(host, { fetchImpl });

    if (result.available) {
      return result;
    }

    await wait(pollIntervalMs);
  }

  return {
    available: false,
    models: [],
  };
}

function checkModel(models, selectedModel) {
  const modelNames = new Set(models.map((model) => model.name).filter(Boolean));

  if (modelNames.has(selectedModel)) {
    return {
      ready: true,
      started: false,
      reason: 'Ollama is ready.',
    };
  }

  return missingSetup(`Configured Ollama model is not installed: ${selectedModel}`);
}

function missingSetup(reason, extra = {}) {
  return {
    ready: false,
    started: false,
    reason,
    ...extra,
  };
}

function isLocalOllamaHost(host) {
  try {
    const parsed = new URL(host);
    return ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function startOllamaServer() {
  try {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();

    return {
      started: true,
    };
  } catch (error) {
    return {
      started: false,
      error,
    };
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createOllamaFetchHeaders(host) {
  return isCloudflareTunnelHost(host)
    ? { 'bypass-tunnel-reminder': 'true' }
    : {};
}

function isCloudflareTunnelHost(host) {
  try {
    return new URL(host).hostname.endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
}