// Import spawn so commands run without unsafe shell interpolation.
import { spawn } from 'node:child_process';
// Import platform to run Windows-only PATH repair.
import { platform } from 'node:os';
// Import dirname so the Ollama install folder can be added to PATH.
import { dirname } from 'node:path';
// Import Windows helpers for Ollama installs that exist but are missing from PATH.
import { ensureWindowsPathContains, findWindowsOllamaExecutable } from './windowsSetup.js';

// Define the local Ollama API endpoint used by JARVIS.
export const OLLAMA_HOST = 'http://127.0.0.1:11434';

// Check whether the Ollama CLI exists and report its version.
export async function getOllamaVersion() {
  // Run the official version command.
  const result = await runCommand('ollama', ['--version']);

  // Treat exit code 0 as a successful Ollama detection.
  if (result.ok) {
    // Return the detected version string.
    return {
      // Mark Ollama as installed.
      exists: true,
      // Store the version output or a fallback message.
      version: result.stdout.trim() || 'Ollama detected',
    };
  }

  // On Windows, repair installs where ollama.exe exists but PATH is stale.
  if (platform() === 'win32') {
    const repaired = await repairWindowsOllamaPath();

    if (repaired.exists) {
      return repaired;
    }
  }

  // Return a missing result when the command fails.
  return missingOllamaResult(result.error);
}

async function repairWindowsOllamaPath() {
  const installedPath = findWindowsOllamaExecutable();

  if (!installedPath) {
    return missingOllamaResult();
  }

  try {
    const pathUpdate = await ensureWindowsPathContains(dirname(installedPath));
    const result = await runCommand(installedPath, ['--version']);

    if (!result.ok) {
      return missingOllamaResult(result.error);
    }

    return {
      exists: true,
      version: result.stdout.trim() || 'Ollama detected',
      path: installedPath,
      pathUpdated: pathUpdate.userChanged || pathUpdate.currentChanged,
    };
  } catch (error) {
    return missingOllamaResult(error);
  }
}

function missingOllamaResult(error = null) {
  return {
    // Mark Ollama as not installed or not on PATH.
    exists: false,
    // No version is available when missing.
    version: null,
    // Keep the error for callers that want diagnostics.
    error,
  };
}

// Read the installed Ollama model list.
export async function getOllamaModels() {
  // Run the Ollama model list command.
  const result = await runCommand('ollama', ['list']);

  // Return a clear failure if the command could not run.
  if (!result.ok) {
    // Include stderr or the spawn error for useful setup messages.
    return {
      // Mark the list operation as failed.
      ok: false,
      // Return an empty model list on failure.
      models: [],
      // Preserve the most helpful error text.
      output: result.stderr || result.error?.message || 'Could not run ollama list.',
    };
  }

  // Parse and return installed model names.
  return {
    // Mark the list operation as successful.
    ok: true,
    // Convert Ollama table output into model objects.
    models: parseOllamaList(result.stdout),
    // Keep raw output for debugging if needed.
    output: result.stdout,
  };
}

// Check if the selected model exists in the installed model list.
export function hasModel(models, selectedModel) {
  // Compare exact names and tag-compatible names.
  return models.some((model) => (
    // Match the exact selected model name.
    model.name === selectedModel
    // Match installed tagged variants when the user entered a base name.
    || model.name.startsWith(`${selectedModel}:`)
    // Match selected tagged variants when the installed name is a base name.
    || selectedModel.startsWith(`${model.name}:`)
  ));
}

// Pull a missing Ollama model with user-visible progress.
export async function pullModel(model, { stdio = 'inherit' } = {}) {
  // Run ollama pull with arguments instead of string-building a shell command.
  return runCommand('ollama', ['pull', model], { stdio });
}

// Check whether the local Ollama HTTP server is reachable.
export async function isOllamaServerRunning({ host = OLLAMA_HOST } = {}) {
  // Use fetch against the official tags endpoint.
  try {
    // Ask Ollama for its installed model tags.
    const response = await fetch(`${host}/api/tags`);
    // Treat HTTP 2xx as server-ready.
    return response.ok;
  // Treat network errors as the server not running.
  } catch {
    // Return false instead of throwing during readiness checks.
    return false;
  }
}

// Start the Ollama server in the background.
export function startOllamaServer() {
  // Spawn ollama serve detached so the CLI can continue.
  const child = spawn('ollama', ['serve'], {
    // Detach so the server can outlive this setup process.
    detached: true,
    // Ignore stdio so the background process does not hold the terminal.
    stdio: 'ignore',
    // Hide extra Windows console windows.
    windowsHide: true,
  });

  // Allow Node to exit without waiting for the server process.
  child.unref();
  // Return the pid for user feedback.
  return child.pid;
}

// Wait until the Ollama HTTP API starts responding.
export async function waitForOllamaServer({ host = OLLAMA_HOST, timeoutMs = 12000 } = {}) {
  // Record the timeout start time.
  const startedAt = Date.now();

  // Poll until the timeout expires.
  while (Date.now() - startedAt < timeoutMs) {
    // Stop waiting as soon as the server responds.
    if (await isOllamaServerRunning({ host })) {
      // Report that Ollama is ready.
      return true;
    }

    // Pause briefly between readiness checks.
    await wait(500);
  }

  // Report that the server did not become ready in time.
  return false;
}

// Run a command safely with spawn and capture its output.
export function runCommand(command, args, options = {}) {
  // Wrap child process completion in a promise.
  return new Promise((resolve) => {
    // Accumulate stdout text for callers.
    let stdout = '';
    // Accumulate stderr text for callers.
    let stderr = '';

    // Start the command without a shell by default.
    const child = spawn(command, args, {
      // Disable shell parsing to avoid command injection.
      shell: false,
      // Hide extra Windows console windows.
      windowsHide: true,
      // Use caller stdio or capture output by default.
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      // Pass through the environment unless overridden.
      env: options.env ?? process.env,
    });

    // Capture stdout when it is piped.
    if (child.stdout) {
      // Append stdout chunks as they arrive.
      child.stdout.on('data', (chunk) => {
        // Convert buffer chunks into text.
        stdout += chunk.toString();
      });
    }

    // Capture stderr when it is piped.
    if (child.stderr) {
      // Append stderr chunks as they arrive.
      child.stderr.on('data', (chunk) => {
        // Convert buffer chunks into text.
        stderr += chunk.toString();
      });
    }

    // Resolve with failure details if the process cannot start.
    child.on('error', (error) => {
      // Return a structured command result instead of throwing.
      resolve({
        // Mark the command as failed.
        ok: false,
        // No exit code exists when spawn itself fails.
        code: null,
        // Include any stdout collected before failure.
        stdout,
        // Include any stderr collected before failure.
        stderr,
        // Include the original spawn error.
        error,
      });
    });

    // Resolve when the process exits.
    child.on('close', (code) => {
      // Return a structured command result.
      resolve({
        // Treat exit code 0 as success.
        ok: code === 0,
        // Preserve the process exit code.
        code,
        // Include captured stdout.
        stdout,
        // Include captured stderr.
        stderr,
        // No spawn error occurred if close fired normally.
        error: null,
      });
    });
  });
}

// Parse the tabular output from ollama list.
function parseOllamaList(output) {
  // Split the table into lines.
  return output
    // Support Windows and Unix line endings.
    .split(/\r?\n/)
    // Drop the header row.
    .slice(1)
    // Trim each model row.
    .map((line) => line.trim())
    // Remove blank lines.
    .filter(Boolean)
    // Convert each row into a model object.
    .map((line) => ({
      // The first column is the model name.
      name: line.split(/\s+/)[0],
      // Keep the full row for diagnostics.
      raw: line,
    }));
}

// Pause async code for a short time.
function wait(ms) {
  // Resolve after the requested delay.
  return new Promise((resolve) => {
    // Schedule the resolver.
    setTimeout(resolve, ms);
  });
}
