import { spawn } from 'node:child_process';
import { runCommand } from '../setup/ollama.js';

const CLOUDFLARED_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const NGROK_URL_PATTERN = /https:\/\/[a-z0-9-]+\.ngrok-free\.app/i;

export async function startBestTunnel({ localUrl, output = process.stdout, timeoutMs = 20000 } = {}) {
  if (await commandExists('cloudflared')) {
    return startTunnelProcess({
      command: 'cloudflared',
      args: ['tunnel', '--url', localUrl],
      pattern: CLOUDFLARED_URL_PATTERN,
      output,
      timeoutMs,
    });
  }

  if (await commandExists('ngrok')) {
    return startTunnelProcess({
      command: 'ngrok',
      args: ['http', localUrl],
      pattern: NGROK_URL_PATTERN,
      output,
      timeoutMs,
    });
  }

  throw new Error('No tunnel command found. Install cloudflared or ngrok, then run host setup again.');
}

async function commandExists(command) {
  const result = await runCommand(command, ['--version']);
  return result.ok;
}

function startTunnelProcess({ command, args, pattern, output, timeoutMs }) {
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
      output.write(`Tunnel online through ${command}: ${match[0]}\n`);
      child.unref();
      resolve({
        provider: command,
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
