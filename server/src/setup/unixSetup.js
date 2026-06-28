// Import spawn to run the official install command.
import { spawn } from 'node:child_process';

// Run the official Ollama install command for macOS/Linux.
//
// The installer uses `sudo`, which prompts for a password on the terminal. If a previous
// interactive wizard prompt left stdin in raw mode (or Node is still reading it), that
// password read never receives input and the install appears frozen at 100%. So before
// running it we put the TTY back into normal (cooked) mode and stop Node from consuming
// stdin, letting sudo prompt and read normally, then restore the prior state afterwards.
export function runUnixOllamaInstall({ spawnFn = spawn, stdin = process.stdin } = {}) {
  return new Promise((resolve, reject) => {
    const isTty = stdin?.isTTY === true;
    const wasRaw = isTty ? stdin.isRaw === true : false;
    const wasPaused = typeof stdin?.isPaused === 'function' ? stdin.isPaused() : false;

    // Hand the terminal to the child cleanly: cooked mode + Node not reading stdin.
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

    // Run the exact official curl-to-sh installer command after confirmation.
    const child = spawnFn('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
      // Attach installer output (and the sudo prompt) to the terminal.
      stdio: 'inherit',
      // Hide extra Windows console windows if somehow called there.
      windowsHide: true,
    });

    // Reject if the installer process cannot start.
    child.on('error', (error) => {
      restore();
      reject(error);
    });

    // Resolve or reject after the installer exits.
    child.on('close', (code) => {
      restore();

      // Treat exit code 0 as success.
      if (code === 0) {
        resolve();
        return;
      }

      // Reject with the installer exit code for troubleshooting.
      reject(new Error(`Ollama install command exited with code ${code}.`));
    });
  });
}
