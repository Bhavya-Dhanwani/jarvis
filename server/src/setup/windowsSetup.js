// Import file helpers for drive checks and installer writes.
import { createWriteStream, existsSync } from 'node:fs';
// Import mkdtemp to create a safe temporary download folder.
import { mkdtemp } from 'node:fs/promises';
// Import https.get to download the official installer.
import { get } from 'node:https';
// Import tmpdir so downloads go into the OS temp folder.
import { tmpdir } from 'node:os';
// Import join for cross-platform path building.
import { join } from 'node:path';
// Import spawn to run the installer without shell interpolation.
import { spawn } from 'node:child_process';

// Store the official Ollama Windows installer URL.
const WINDOWS_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

// Validate a Windows drive letter entered by the user.
export function validateWindowsDrive(drive) {
  // Normalize entries like "d:" into "D".
  const normalized = drive.trim().replace(':', '').toUpperCase();

  // Reject anything that is not exactly one drive letter.
  if (!/^[A-Z]$/.test(normalized)) {
    // Return a validation error for the prompt loop.
    return {
      // Mark the drive as invalid.
      ok: false,
      // Include the normalized input for debugging.
      drive: normalized,
      // No path is available for invalid input.
      path: null,
      // Explain the accepted format to the user.
      error: 'Enter a single drive letter, such as C, D, or E.',
    };
  }

  // Build the Windows root path for the drive.
  const path = `${normalized}:\\`;
  // Return whether the drive path exists on this machine.
  return {
    // Mark valid only when the drive root exists.
    ok: existsSync(path),
    // Store the normalized drive letter.
    drive: normalized,
    // Store the drive root path.
    path,
    // Explain missing drives to the user.
    error: existsSync(path) ? null : `Drive ${normalized}: does not exist.`,
  };
}

// Download the official Windows installer to a temporary file.
export async function downloadWindowsInstaller({ output = process.stdout } = {}) {
  // Create a unique temporary directory.
  const tempDir = await mkdtemp(join(tmpdir(), 'jarvis-ollama-'));
  // Build the installer path inside the temporary directory.
  const installerPath = join(tempDir, 'OllamaSetup.exe');

  // Download the installer file.
  await downloadFile(WINDOWS_INSTALLER_URL, installerPath, { output });
  // Return the downloaded installer path.
  return installerPath;
}

// Run the downloaded Windows installer.
export function runWindowsInstaller(installerPath) {
  // Wrap installer completion in a promise.
  return new Promise((resolve, reject) => {
    // Start the installer directly, not through a shell.
    const child = spawn(installerPath, [], {
      // Disable shell parsing for safety.
      shell: false,
      // Attach installer IO so Windows prompts and progress are visible.
      stdio: 'inherit',
      // Allow Windows installer UI/UAC to appear.
      windowsHide: false,
    });

    // Reject if the installer fails to start.
    child.on('error', reject);
    // Resolve or reject after installer exit.
    child.on('close', (code) => {
      // Treat exit code 0 as success.
      if (code === 0) {
        // Resolve the install promise.
        resolve();
        // Stop after success.
        return;
      }

      // Reject with the installer exit code for troubleshooting.
      reject(new Error(`Ollama installer exited with code ${code}.`));
    });
  });
}

// Download a URL to a local destination file.
function downloadFile(url, destination, { output }) {
  // Wrap the streaming download in a promise.
  return new Promise((resolve, reject) => {
    // Start the HTTPS request.
    const request = get(url, (response) => {
      // Follow common HTTP redirect responses.
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        // Download from the redirect location.
        downloadFile(response.headers.location, destination, { output }).then(resolve, reject);
        // Stop handling this redirected response.
        return;
      }

      // Reject non-successful HTTP responses.
      if (response.statusCode !== 200) {
        // Include the HTTP status in the error message.
        reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        // Stop processing a failed response.
        return;
      }

      // Read the content length when the server provides it.
      const total = Number(response.headers['content-length'] ?? 0);
      // Track bytes received for progress output.
      let received = 0;
      // Create the destination file and fail if it already exists.
      const file = createWriteStream(destination, { flags: 'wx' });

      // Update progress as data arrives.
      response.on('data', (chunk) => {
        // Add the current chunk size to the received total.
        received += chunk.length;
        // Print percentage progress only for interactive terminals.
        if (total && output.isTTY) {
          // Calculate a bounded integer percentage.
          const percent = Math.min(100, Math.round((received / total) * 100));
          // Rewrite the same terminal line with progress.
          output.write(`\rDownloading official Ollama installer... ${percent}%`);
        }
      });

      // Resolve once the file stream finishes writing.
      file.on('finish', () => {
        // Add a newline after the progress line in TTY mode.
        if (output.isTTY) {
          // Move the terminal cursor to the next line.
          output.write('\n');
        }
        // Close the file before resolving.
        file.close(resolve);
      });

      // Reject if writing to disk fails.
      file.on('error', reject);
      // Pipe the HTTPS response into the installer file.
      response.pipe(file);
    });

    // Reject if the HTTPS request itself fails.
    request.on('error', reject);
  });
}
