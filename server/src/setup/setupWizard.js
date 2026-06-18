// Import existsSync to check whether config files already exist.
import { existsSync } from 'node:fs';
// Import promise-based file helpers for creating folders and writing config.
import { mkdir, writeFile } from 'node:fs/promises';
// Import path helpers for building config and data paths.
import { dirname, join } from 'node:path';
// Import homedir for the default Unix-style data location.
import { homedir } from 'node:os';
// Import system detection for OS and architecture checks.
import { detectSystem } from './detectSystem.js';
// Import Ollama runtime and server helpers.
import {
  // Use the local Ollama API host constant.
  OLLAMA_HOST,
  // Check whether the Ollama CLI is installed.
  getOllamaVersion,
  // Check whether the Ollama HTTP server is running.
  isOllamaServerRunning,
  // Start the Ollama server if the user confirms.
  startOllamaServer,
  // Wait for the Ollama server to become ready.
  waitForOllamaServer,
} from './ollama.js';
// Import default model and model installation helper.
import { DEFAULT_MODEL, ensureModel } from './model.js';
// Import Windows-specific drive and installer helpers.
import { downloadWindowsInstaller, runWindowsInstaller, validateWindowsDrive } from './windowsSetup.js';
// Import macOS/Linux installer helper.
import { runUnixOllamaInstall } from './unixSetup.js';
// Import JARVIS-themed text UI helpers.
import { playBootSequence, typewriter, banner } from '../ui/ascii.js';
// Import prompt session wrapper for confirmations and questions.
import { PromptSession } from '../ui/prompts.js';
// Import loading animations and spinner helper.
import { loading, withSpinner } from '../ui/spinner.js';

// Run the complete first-run setup wizard.
export async function runSetupWizard({
  // Use stdin by default for interactive answers.
  input = process.stdin,
  // Use stdout by default for wizard output.
  output = process.stdout,
  // Use process.env by default for model overrides.
  env = process.env,
} = {}) {
  // Show the animated JARVIS boot sequence before prompts begin.
  await playBootSequence({ output });
  // Create the prompt session after animation so piped input is not consumed early.
  const prompts = new PromptSession({ input, output });

  // Ensure readline is closed even if setup fails.
  try {
    // Ask for explicit permission to continue setup.
    const shouldContinue = await prompts.confirm('Continue setup?', { defaultValue: true });
    // Stop immediately if the user does not want to proceed.
    if (!shouldContinue) {
      // Tell the user the wizard stopped intentionally.
      output.write('Setup aborted by user.\n');
      // Return an aborted result for tests or callers.
      return { status: 'aborted' };
    }

    // Detect OS, release, architecture, and support flags.
    const system = detectSystem();
    // Show a small loading animation for system scanning.
    await loading('Scanning host system...', { output });
    // Print the detected OS.
    output.write(`OS: ${system.os} ${system.release}\n`);
    // Print the detected architecture.
    output.write(`Architecture: ${system.arch}\n`);

    // Block unsupported operating systems.
    if (!system.supportedOs) {
      // Explain which OS values are supported.
      throw new Error(`Unsupported OS: ${system.platform}. Supported: Windows, macOS, Linux.`);
    }

    // Block unsupported CPU architectures.
    if (!system.supportedArch) {
      // Explain which architecture values are supported.
      throw new Error(`Unsupported architecture: ${system.arch}. Supported: x64, arm64.`);
    }

    // Choose the data root based on platform.
    const dataRoot = system.isWindows
      // Ask Windows users which drive to use.
      ? await chooseWindowsDataRoot(prompts, output)
      // Use the home folder default on macOS/Linux.
      : join(homedir(), '.jarvis');

    // Ensure Ollama CLI exists or install it after confirmation.
    await ensureOllamaInstalled(system, prompts, { output });
    // Ensure the Ollama server is reachable or start it after confirmation.
    await ensureOllamaServer(prompts, { output });

    // Ask which model JARVIS should use.
    const selectedModel = await prompts.ask('Select Ollama model', {
      // Use environment override or the requested default model.
      defaultValue: env.JARVIS_OLLAMA_MODEL ?? DEFAULT_MODEL,
      // Validate that the user did not enter an empty model name.
      validate(value) {
        // Return null when valid or an error message when invalid.
        return value.length > 0 ? null : 'Model name cannot be empty.';
      },
    });

    // Ensure the selected model exists locally or pull it after confirmation.
    await ensureModel(selectedModel, prompts, { output });
    // Save the selected setup configuration.
    await saveConfig({
      // Store the chosen data root.
      dataRoot,
      // Store the selected model.
      model: selectedModel,
      // Store the Ollama host.
      host: OLLAMA_HOST,
      // Store basic detected system metadata.
      system,
      // Reuse prompts for overwrite confirmation.
      prompts,
      // Reuse output for status messages.
      output,
    });

    // Print the final online message with a typewriter effect.
    await typewriter('JARVIS is online.', { output, speed: 20 });
    // Print the final success banner.
    banner('JARVIS is online. Local AI core ready.', { output });
    // Return setup details to callers.
    return { status: 'ok', command: 'setup', model: selectedModel, dataRoot };
  // Always release readline resources.
  } finally {
    // Close the prompt session.
    prompts.close();
  }
}

// Ask Windows users which drive should hold JARVIS data.
async function chooseWindowsDataRoot(prompts, output) {
  // Keep asking until the user approves a valid drive.
  while (true) {
    // Prompt for a drive letter.
    const selectedDrive = await prompts.ask('Which drive should JARVIS data use?', {
      // Default to C when the user presses Enter.
      defaultValue: 'C',
      // Validate the entered drive letter.
      validate(value) {
        // Check that the drive exists.
        const result = validateWindowsDrive(value);
        // Return null for valid drives or an error message.
        return result.ok ? null : result.error;
      },
    });

    // Normalize and validate the chosen drive again for path building.
    const drive = validateWindowsDrive(selectedDrive);
    // Build the JARVIS data folder on that drive.
    const dataRoot = join(drive.path, 'Jarvis', 'data');
    // Ask for confirmation before using the selected drive path.
    const approved = await prompts.confirm(`Use ${dataRoot} for JARVIS data?`, { defaultValue: true });

    // Return the path only after the user approves it.
    if (approved) {
      // Tell the user which data path was selected.
      output.write(`JARVIS data core selected: ${dataRoot}\n`);
      // Return the approved path to the wizard.
      return dataRoot;
    }
  }
}

// Ensure Ollama is installed before model and server setup.
async function ensureOllamaInstalled(system, prompts, { output }) {
  // Check for the Ollama CLI with a spinner.
  const initial = await withSpinner('Checking Ollama runtime...', () => getOllamaVersion(), { output });

  // Continue if Ollama is already installed.
  if (initial.exists) {
    // Print the detected version.
    output.write(`Ollama runtime detected: ${initial.version}\n`);
    // Stop install flow because nothing else is needed.
    return;
  }

  // Ask before installing Ollama.
  const approved = await prompts.confirm('Ollama is missing. Install Ollama now?', { defaultValue: true });
  // Stop setup if installation is declined.
  if (!approved) {
    // Tell the user where to install manually.
    throw new Error('Setup stopped. Install Ollama later from https://ollama.com/download');
  }

  // Use the Windows installer flow on Windows.
  if (system.isWindows) {
    // Warn that Windows may display UAC/admin UI.
    output.write('Windows may show a UAC/admin popup during the Ollama installer.\n');
    // Download the official installer with a spinner.
    const installer = await withSpinner(
      // Describe the installer download step.
      'Downloading official Ollama Windows installer...',
      // Download the installer and return its path.
      () => downloadWindowsInstaller({ output }),
      // Send spinner output to the selected stream.
      { output },
    );
    // Run the downloaded installer.
    await runWindowsInstaller(installer);
  // Use the official shell installer on macOS/Linux.
  } else {
    // Show the exact command before asking to run it.
    output.write('About to run: curl -fsSL https://ollama.com/install.sh | sh\n');
    // Ask before running the install command.
    const runInstall = await prompts.confirm('Run official Ollama install command?', { defaultValue: true });
    // Stop if the user declines the Unix install command.
    if (!runInstall) {
      // Explain that setup stopped before mutation.
      throw new Error('Setup stopped before running the Ollama installer.');
    }
    // Run the official macOS/Linux install command.
    await runUnixOllamaInstall();
  }

  // Verify Ollama exists after installation.
  const afterInstall = await withSpinner('Verifying Ollama installation...', () => getOllamaVersion(), { output });

  // Fail with a helpful message if Ollama is still unavailable.
  if (!afterInstall.exists) {
    // Suggest reopening the terminal because PATH may not be refreshed.
    throw new Error(
      'Ollama is still missing after install. Close and reopen your terminal, then run "ollama --version".',
    );
  }

  // Print the verified Ollama version.
  output.write(`Ollama runtime detected: ${afterInstall.version}\n`);
}

// Ensure the Ollama HTTP server is reachable.
async function ensureOllamaServer(prompts, { output }) {
  // Check the local Ollama API endpoint with a spinner.
  const running = await withSpinner(
    // Describe the server readiness check.
    'Checking local Ollama server...',
    // Test the /api/tags endpoint.
    () => isOllamaServerRunning({ host: OLLAMA_HOST }),
    // Send spinner output to the selected stream.
    { output },
  );

  // Continue if the server is already running.
  if (running) {
    // Tell the user the API is reachable.
    output.write('Local Ollama server responding at http://localhost:11434/api/tags\n');
    // Stop server setup because it is ready.
    return;
  }

  // Ask before starting the server.
  const start = await prompts.confirm('Ollama server is not running. Start it with "ollama serve"?', {
    // Default to starting because setup needs the server.
    defaultValue: true,
  });

  // Stop setup if the user declines server startup.
  if (!start) {
    // Tell the user how to start manually.
    throw new Error('Setup stopped. Start Ollama later with: ollama serve');
  }

  // Start the server in the background.
  const pid = startOllamaServer();
  // Print the launch result and pid when available.
  output.write(`Ollama serve launch requested${pid ? ` (pid ${pid})` : ''}.\n`);
  // Wait until the API responds.
  const ready = await withSpinner(
    // Describe the wait step in JARVIS language.
    'Waiting for local intelligence core...',
    // Poll the server until ready or timed out.
    () => waitForOllamaServer({ host: OLLAMA_HOST }),
    // Send spinner output to the selected stream.
    { output },
  );

  // Fail if the server never responded.
  if (!ready) {
    // Give the exact endpoint and manual command.
    throw new Error('Ollama server did not respond at http://localhost:11434/api/tags. Try running "ollama serve".');
  }
}

// Save setup configuration to the selected data folder.
async function saveConfig({ dataRoot, model, host, system, prompts, output }) {
  // Build the config file path.
  const configPath = join(dataRoot, 'config.json');
  // Ensure the config folder exists.
  await mkdir(dirname(configPath), { recursive: true });

  // Ask before overwriting an existing config file.
  if (existsSync(configPath)) {
    // Prompt the user because overwriting is a file mutation.
    const overwrite = await prompts.confirm(`Config already exists at ${configPath}. Overwrite it?`, {
      // Default to no so existing files are safe.
      defaultValue: false,
    });

    // Leave the existing file untouched if declined.
    if (!overwrite) {
      // Tell the user the config was not changed.
      output.write(`Config left unchanged: ${configPath}\n`);
      // Exit config saving early.
      return;
    }
  }

  // Build the config object to write as JSON.
  const config = {
    // Store the agent name.
    name: 'JARVIS',
    // Store the selected model.
    model,
    // Store the Ollama host URL.
    host,
    // Store the selected data root.
    dataRoot,
    // Store the setup timestamp.
    createdAt: new Date().toISOString(),
    // Store basic host system information.
    system: {
      // Store the friendly OS name.
      os: system.os,
      // Store the raw platform name.
      platform: system.platform,
      // Store the CPU architecture label.
      arch: system.arch,
    },
  };

  // Write the config JSON to disk.
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'w' });
  // Tell the user where the config was saved.
  output.write(`Configuration saved: ${configPath}\n`);
}
