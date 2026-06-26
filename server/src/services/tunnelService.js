import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { arch, platform, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { runCommand } from '../setup/ollama.js';
import { getDefaultDataRoot } from './runtimeModeService.js';

const CLOUDFLARED_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const NGROK_URL_PATTERN = /https:\/\/[a-z0-9-]+\.ngrok-free\.app/i;
const CLOUD_FLARED_RELEASE_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
const gunzipAsync = promisify(gunzip);

export async function startBestTunnel({
  localUrl,
  output = process.stdout,
  timeoutMs = 20000,
  dataRoot = getDefaultDataRoot(),
} = {}) {
  const cloudflaredArgs = buildCloudflaredArgs(localUrl);

  if (await commandExists('cloudflared')) {
    return startTunnelProcess({
      command: 'cloudflared',
      args: cloudflaredArgs,
      pattern: CLOUDFLARED_URL_PATTERN,
      output,
      timeoutMs,
    });
  }

  if (await commandExists('ngrok')) {
    return startTunnelProcess({
      command: 'ngrok',
      provider: 'ngrok',
      args: ['http', localUrl],
      pattern: NGROK_URL_PATTERN,
      output,
      timeoutMs,
    });
  }

  const managedCloudflared = await ensureManagedCloudflared({ dataRoot, output });

  if (managedCloudflared) {
    return startTunnelProcess({
      command: managedCloudflared,
      provider: 'cloudflared',
      args: cloudflaredArgs,
      pattern: CLOUDFLARED_URL_PATTERN,
      output,
      timeoutMs,
    });
  }

  throw new Error('Could not prepare a tunnel automatically. Check your internet connection and run host setup again.');
}

// Ollama rejects requests whose Host header is not localhost/127.0.0.1 with a 403.
// cloudflared forwards the public *.trycloudflare.com hostname by default, so we
// rewrite the Host header to the local origin to keep Ollama reachable through the tunnel.
function buildCloudflaredArgs(localUrl) {
  const args = ['tunnel', '--url', localUrl];
  const hostHeader = localHostHeader(localUrl);

  if (hostHeader) {
    args.push('--http-host-header', hostHeader);
  }

  return args;
}

function localHostHeader(localUrl) {
  try {
    return new URL(localUrl).host;
  } catch {
    return null;
  }
}

async function commandExists(command) {
  const result = await runCommand(command, ['--version']);
  return result.ok;
}

async function ensureManagedCloudflared({ dataRoot, output }) {
  const asset = getCloudflaredAsset();

  if (!asset) {
    return null;
  }

  const executablePath = join(dataRoot, 'bin', asset.executableName);

  if (existsSync(executablePath)) {
    return executablePath;
  }

  output.write(`cloudflared not found. Downloading managed tunnel binary...\n`);
  await mkdir(dirname(executablePath), { recursive: true });

  if (asset.archive) {
    await downloadAndExtractCloudflared(asset.url, executablePath);
  } else {
    await downloadFile(asset.url, executablePath);
  }

  if (platform() !== 'win32') {
    await chmod(executablePath, 0o755);
  }

  const result = await runCommand(executablePath, ['--version']);

  if (!result.ok) {
    await rm(executablePath, { force: true });
    throw new Error(result.stderr || result.error?.message || 'Downloaded cloudflared could not be verified.');
  }

  output.write(`Managed cloudflared ready: ${executablePath}\n`);
  return executablePath;
}

function getCloudflaredAsset() {
  const os = platform();
  const cpu = arch();

  if (os === 'win32' && (cpu === 'x64' || cpu === 'arm64')) {
    return cloudflaredAsset('cloudflared-windows-amd64.exe', 'cloudflared.exe');
  }

  if (os === 'linux' && cpu === 'x64') {
    return cloudflaredAsset('cloudflared-linux-amd64', 'cloudflared');
  }

  if (os === 'linux' && cpu === 'arm64') {
    return cloudflaredAsset('cloudflared-linux-arm64', 'cloudflared');
  }

  if (os === 'darwin' && cpu === 'x64') {
    return cloudflaredAsset('cloudflared-darwin-amd64.tgz', 'cloudflared', true);
  }

  if (os === 'darwin' && cpu === 'arm64') {
    return cloudflaredAsset('cloudflared-darwin-arm64.tgz', 'cloudflared', true);
  }

  return null;
}

function cloudflaredAsset(fileName, executableName, archive = false) {
  return {
    url: `${CLOUD_FLARED_RELEASE_BASE}/${fileName}`,
    executableName,
    archive,
  };
}

async function downloadAndExtractCloudflared(url, executablePath) {
  const tempDir = await mkdtemp(join(tmpdir(), 'jarvis-cloudflared-'));
  const archivePath = join(tempDir, basename(url));

  try {
    await downloadFile(url, archivePath);
    const archive = await readFile(archivePath);
    const tar = await gunzipAsync(archive);
    const binary = extractTarEntry(tar, 'cloudflared');
    await mkdir(dirname(executablePath), { recursive: true });
    await writeFile(executablePath, binary, { mode: 0o755 });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extractTarEntry(tarBuffer, expectedName) {
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    const rawName = header.subarray(0, 100).toString().replace(/\0.*$/, '');

    if (!rawName) {
      break;
    }

    const sizeText = header.subarray(124, 136).toString().replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (rawName.endsWith(expectedName)) {
      return tarBuffer.subarray(dataStart, dataEnd);
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  throw new Error('Downloaded cloudflared archive did not contain an executable.');
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`cloudflared download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const file = createWriteStream(destination, { flags: 'w' });
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
      response.pipe(file);
    });

    request.on('error', reject);
  });
}

function startTunnelProcess({ command, provider = command, args, pattern, output, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const child = spawn(command, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Timed out waiting for ${command} to provide a public URL.`));
    }, timeoutMs);

    const inspect = (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(pattern);

      if (!match || settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      output.write(`Tunnel online through ${provider}: ${match[0]}\n`);
      child.unref();
      resolve({
        provider,
        url: match[0],
        process: child,
      });
    };

    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.on('error', (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${command} exited before creating a tunnel (code ${code}).`));
      }
    });
  });
}
