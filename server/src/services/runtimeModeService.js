import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

export const RUNTIME_MODES = {
  SELF_HOSTED: 'self-hosted',
  HOST: 'host',
  CLIENT: 'client',
};

const DEFAULT_DATA_ROOT = join(homedir(), '.jarvis');
const CONFIG_FILE = 'config.json';
const AUTH_FILE = 'auth.json';

export function getDefaultDataRoot() {
  return DEFAULT_DATA_ROOT;
}

export function getDefaultConfigPath() {
  return join(DEFAULT_DATA_ROOT, CONFIG_FILE);
}

export function getDefaultAuthPath() {
  return join(DEFAULT_DATA_ROOT, AUTH_FILE);
}

export function normalizeMode(mode) {
  const normalized = String(mode ?? '').trim().toLowerCase();

  if (normalized === 'self hosted' || normalized === 'selfhosted' || normalized === 'local') {
    return RUNTIME_MODES.SELF_HOSTED;
  }

  if (Object.values(RUNTIME_MODES).includes(normalized)) {
    return normalized;
  }

  return null;
}

export function loadJarvisConfig({ env = process.env } = {}) {
  const paths = getConfigCandidates({ env });

  for (const path of paths) {
    const config = readJson(path);

    if (config) {
      return { ...config, path };
    }
  }

  return null;
}

export async function saveJarvisConfig({
  dataRoot = DEFAULT_DATA_ROOT,
  mode,
  model,
  host,
  system,
  signalingServerUrl,
  remoteHostTemporary = false,
}) {
  const configPath = join(dataRoot, CONFIG_FILE);
  const previous = readJson(configPath) ?? {};
  const next = {
    ...previous,
    name: 'JARVIS',
    mode,
    model: model ?? previous.model,
    host: host ?? previous.host,
    dataRoot,
    signalingServerUrl: signalingServerUrl ?? previous.signalingServerUrl,
    remoteHostTemporary,
    updatedAt: new Date().toISOString(),
    createdAt: previous.createdAt ?? new Date().toISOString(),
    system: system
      ? {
          os: system.os,
          platform: system.platform,
          arch: system.arch,
        }
      : previous.system,
  };

  await writeProtectedJson(configPath, next);
  return configPath;
}

export function loadAuth({ env = process.env } = {}) {
  return readJson(env.JARVIS_AUTH_PATH ?? getDefaultAuthPath());
}

export async function saveAuth({ refreshToken, accessToken, user, serverUrl, dataRoot = DEFAULT_DATA_ROOT }) {
  const authPath = join(dataRoot, AUTH_FILE);
  await writeProtectedJson(authPath, {
    refreshToken,
    accessToken,
    user,
    serverUrl,
    updatedAt: new Date().toISOString(),
  });
  return authPath;
}

export async function writeProtectedJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'w', mode: 0o600 });

  if (platform() !== 'win32') {
    await chmod(path, 0o600);
  }
}

function getConfigCandidates({ env }) {
  if (env.JARVIS_CONFIG_PATH) {
    return [env.JARVIS_CONFIG_PATH];
  }

  if (env.JARVIS_DATA_ROOT) {
    return [join(env.JARVIS_DATA_ROOT, CONFIG_FILE)];
  }

  const candidates = [getDefaultConfigPath()];

  if (platform() === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      candidates.push(`${letter}:\\Jarvis\\data\\${CONFIG_FILE}`);
    }
  }

  return [...new Set(candidates)];
}

function readJson(path) {
  try {
    if (!existsSync(path)) {
      return null;
    }

    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
