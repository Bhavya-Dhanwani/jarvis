// Import spawn to run the official install command.
import { spawn } from 'node:child_process';

// Run the official Ollama install command for macOS/Linux.
export function runUnixOllamaInstall() {
  // Wrap installer completion in a promise.
  return new Promise((resolve, reject) => {
    // Run the exact official curl-to-sh installer command after confirmation.
    const child = spawn('sh', ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], {
      // Attach installer output to the terminal.
      stdio: 'inherit',
      // Hide extra Windows console windows if somehow called there.
      windowsHide: true,
    });

    // Reject if the installer process cannot start.
    child.on('error', reject);
    // Resolve or reject after the installer exits.
    child.on('close', (code) => {
      // Treat exit code 0 as success.
      if (code === 0) {
        // Resolve the install promise.
        resolve();
        // Stop after success.
        return;
      }

      // Reject with the installer exit code for troubleshooting.
      reject(new Error(`Ollama install command exited with code ${code}.`));
    });
  });
}
