// Import spawn to run the official install commands.
import { spawn } from 'node:child_process';

// Run an installer command with its output (and any sudo/Homebrew prompt) attached to the
// terminal. The child gets a cooked TTY with Node not consuming stdin, so password prompts
// are read normally — a prior interactive prompt can leave stdin in raw mode, which made
// the install appear frozen at 100% while it silently waited for input. State is restored
// when the child exits.
function runInstaller(command, args, { spawnFn = spawn, stdin = process.stdin } = {}) {
  return new Promise((resolve, reject) => {
    const isTty = stdin?.isTTY === true;
    const wasRaw = isTty ? stdin.isRaw === true : false;
    const wasPaused = typeof stdin?.isPaused === 'function' ? stdin.isPaused() : false;

    if (isTty && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false);
    }
    stdin?.pause?.();

    const restore = () => {
      if (isTty && typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(wasRaw);
      }

      if (!wasPaused) {
        stdin?.resume?.();
      }
    };

    let child;

    try {
      child = spawnFn(command, args, { stdio: 'inherit', windowsHide: true });
    } catch (error) {
      restore();
      reject(error);
      return;
    }

    child.on('error', (error) => {
      restore();
      reject(error);
    });

    child.on('close', (code) => {
      restore();

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Install command exited with code ${code}.`));
    });
  });
}

// Linux: run the official Ollama curl-to-sh installer (uses sudo).
export function runUnixOllamaInstall({ spawnFn = spawn, stdin = process.stdin } = {}) {
  return runInstaller('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], { spawnFn, stdin });
}

// macOS: install Ollama with Homebrew. The Linux curl script does not install Ollama on
// macOS, so Homebrew (or the downloadable app) is the correct path.
export function runMacBrewInstall({ spawnFn = spawn, stdin = process.stdin } = {}) {
  return runInstaller('brew', ['install', 'ollama'], { spawnFn, stdin });
}

// Detect whether Homebrew is available (`brew --version` exits 0).
export function isHomebrewAvailable({ spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let child;

    try {
      child = spawnFn('brew', ['--version'], { stdio: 'ignore', windowsHide: true });
    } catch {
      resolve(false);
      return;
    }

    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
