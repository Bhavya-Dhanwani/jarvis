// Import file helpers for drive checks and installer writes.
import { createWriteStream, existsSync } from 'node:fs';
// Import mkdtemp to create a safe temporary download folder.
import { mkdtemp, rm } from 'node:fs/promises';
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

// Find a Windows Ollama install that exists but is not exposed on PATH.
export function findWindowsOllamaExecutable(env = process.env) {
  // Check the default per-user install first because Ollama commonly installs there.
  const candidates = [
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : null,
    env.ProgramFiles ? join(env.ProgramFiles, 'Ollama', 'ollama.exe') : null,
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'Ollama', 'ollama.exe') : null,
  ].filter(Boolean);

  // Return the first real executable path.
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

// Ensure the Ollama install directory is available now and in future terminals.
export async function ensureWindowsPathContains(directory, { env = process.env } = {}) {
  // Add the path to the current process so the rest of setup can keep going.
  const currentChanged = addDirectoryToEnvPath(directory, env);
  // Read the persistent user PATH from HKCU\Environment.
  const userPath = await readUserPath();

  // Nothing else to do when future terminals already include the directory.
  if (pathContainsDirectory(userPath, directory)) {
    return { currentChanged, userChanged: false };
  }

  // Append the directory to the persistent user PATH without requiring admin rights.
  const newUserPath = appendPathEntry(userPath, directory);
  const result = await runWindowsCommand('reg.exe', [
    'add',
    'HKCU\\Environment',
    '/v',
    'Path',
    '/t',
    'REG_EXPAND_SZ',
    '/d',
    newUserPath,
    '/f',
  ]);

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || 'Could not update the Windows user PATH.');
  }

  return { currentChanged, userChanged: true };
}

// Delete a downloaded installer after the installer process exits.
export async function removeInstallerFile(installerPath) {
  if (!installerPath) {
    return;
  }

  await rm(installerPath, { force: true });
}

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

// Read the current user's persisted PATH value from the registry.
async function readUserPath() {
  const result = await runWindowsCommand('reg.exe', [
    'query',
    'HKCU\\Environment',
    '/v',
    'Path',
  ]);

  if (!result.ok) {
    return '';
  }

  const line = result.stdout
    .split(/\r?\n/)
    .find((entry) => /\sPath\s+REG_/.test(entry));

  if (!line) {
    return '';
  }

  return line.replace(/^\s*Path\s+REG_\w+\s+/, '').trim();
}

// Run a small Windows utility and capture output.
function runWindowsCommand(command, args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      resolve({ ok: false, code: null, stdout, stderr, error });
    });

    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr, error: null });
    });
  });
}

// Add a directory to the current process PATH.
function addDirectoryToEnvPath(directory, env) {
  const key = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'Path';
  const current = env[key] ?? '';

  if (pathContainsDirectory(current, directory)) {
    return false;
  }

  env[key] = appendPathEntry(current, directory);
  return true;
}

// Append a PATH entry with one trailing semicolon for Windows tools.
function appendPathEntry(pathValue, directory) {
  const trimmed = pathValue.trim();

  if (!trimmed) {
    return `${directory};`;
  }

  return `${trimmed.replace(/;+$/, '')};${directory};`;
}

// Compare PATH entries case-insensitively on Windows.
function pathContainsDirectory(pathValue, directory) {
  const target = normalizePathEntry(directory);

  return pathValue
    .split(';')
    .map(normalizePathEntry)
    .some((entry) => entry === target);
}

// Normalize a PATH entry for comparison.
function normalizePathEntry(entry) {
  return entry.trim().replace(/[\\/]+$/, '').toLowerCase();
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
