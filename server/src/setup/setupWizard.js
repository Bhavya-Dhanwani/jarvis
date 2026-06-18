import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { detectSystem } from './detectSystem.js';
import {
  OLLAMA_HOST,
  getOllamaModels,
  getOllamaVersion,
  hasModel,
  isOllamaServerRunning,
  pullModel,
  startOllamaServer,
  waitForOllamaServer,
} from './ollama.js';
import { DEFAULT_MODEL } from './model.js';
import {
  downloadWindowsInstaller,
  ensureWindowsPathContains,
  findWindowsOllamaExecutable,
  removeInstallerFile,
  runWindowsInstaller,
  validateWindowsDrive,
} from './windowsSetup.js';
import { runUnixOllamaInstall } from './unixSetup.js';
import { banner, playBootSequence, playOnlineSequence, typewriter } from '../ui/ascii.js';
import { PromptSession } from '../ui/prompts.js';
import { loading, withSpinner } from '../ui/spinner.js';
import { withProgress } from '../ui/progress.js';
import {
  card,
  divider,
  errorBox,
  section,
  statusLine,
  successBox,
  theme,
  warningBox,
} from '../ui/theme.js';

export async function runSetupWizard({
  input = process.stdin,
  output = process.stdout,
  env = process.env,
} = {}) {
  await playBootSequence({ output });
  const prompts = new PromptSession({ input, output });

  try {
    const shouldContinue = await prompts.confirm('Continue JARVIS first-run setup?', {
      defaultValue: true,
      hint: 'The wizard will scan your system and ask before every install, server start, model pull, or overwrite.',
    });

    if (!shouldContinue) {
      output.write(warningBox('Setup aborted by user. No changes were made.'));
      return { status: 'aborted' };
    }

    output.write(section('SYSTEM SCAN'));
    const system = await withSpinner('Scanning host system', async () => detectSystem(), { output });
    output.write(statusLine('success', 'OS detected', `${system.os} ${system.release}`));
    output.write(statusLine('success', 'Architecture', system.arch));

    if (!system.supportedOs) {
      throw new Error(`Unsupported OS: ${system.platform}. Supported: Windows, macOS, Linux.`);
    }

    if (!system.supportedArch) {
      throw new Error(`Unsupported architecture: ${system.arch}. Supported: x64, arm64.`);
    }

    const ollamaVersion = await ensureOllamaInstalled(system, prompts, { output });
    const dataRoot = system.isWindows
      ? await chooseWindowsDataRoot(prompts, output)
      : join(homedir(), '.jarvis');

    if (!system.isWindows) {
      output.write(statusLine('success', 'Data core', dataRoot));
    }

    await ensureOllamaServer(prompts, { output });

    const modelStatus = await ensureSelectedModel(prompts, {
      defaultModel: env.JARVIS_OLLAMA_MODEL ?? DEFAULT_MODEL,
      output,
    });

    output.write(section('CONFIGURATION'));
    const configPath = await saveConfig({
      dataRoot,
      model: modelStatus.model,
      host: OLLAMA_HOST,
      system,
      prompts,
      output,
    });

    output.write(card('STATUS CARDS', [
      ['OS', `${system.os} ${system.release}`],
      ['Architecture', system.arch],
      ['Selected drive', system.isWindows ? `${dataRoot.slice(0, 3)}` : 'Home'],
      ['Ollama version', ollamaVersion],
      ['Selected model', modelStatus.model],
      ['Model status', modelStatus.pulled ? 'Downloaded' : 'Ready'],
    ], { borderColor: 'cyan' }));
    output.write('\n');

    output.write(section('LAUNCH'));
    await loading('Finalizing local intelligence core', { output, durationMs: 900 });
    await playOnlineSequence({ output });
    output.write(successBox('JARVIS is online. Local AI core ready.'));
    output.write(card('CONFIG SUMMARY', [
      ['Config', configPath ?? 'Unchanged'],
      ['JARVIS data', dataRoot],
      ['Ollama host', OLLAMA_HOST],
      ['Model', modelStatus.model],
    ], { borderColor: 'green' }));
    output.write('\n');
    banner('JARVIS is online. Local AI core ready.', { output });

    return {
      status: 'ok',
      command: 'setup',
      model: modelStatus.model,
      dataRoot,
    };
  } catch (error) {
    output.write('\n');
    output.write(errorBox(error.message));
    process.exitCode = 1;
    return { status: 'failed', command: 'setup', error };
  } finally {
    prompts.close();
  }
}

async function chooseWindowsDataRoot(prompts, output) {
  output.write(section('SELECT DATA CORE'));
  output.write(warningBox(
    'The selected drive is for JARVIS config, logs, workspace, and optional cache/model paths if supported later. Ollama may still install to its Windows default location.',
  ));

  const drives = await withSpinner('Detecting available Windows drives', async () => detectWindowsDrives(), { output });
  output.write(statusLine('success', 'Available drives found', drives.map((drive) => drive.path).join(', ')));

  while (true) {
    const selectedDrive = await prompts.select(
      'Choose where JARVIS should store its data. Ollama may still install to Windows default location.',
      drives.map((drive) => ({
      title: `${drive.path}  ${drive.label}`,
      description: drive.description,
      value: drive.drive,
      })),
      {
        initial: Math.max(0, drives.findIndex((drive) => drive.recommended)),
      },
    );

    const drive = validateWindowsDrive(selectedDrive);
    const dataRoot = join(drive.path, 'Jarvis', 'data');
    const approved = await prompts.confirm(`Use ${theme.title(dataRoot)} for JARVIS data?`, {
      defaultValue: true,
      hint: 'This path is for JARVIS config, logs, workspace, and future optional cache/model paths. It does not control where Ollama installs.',
    });

    if (approved) {
      output.write(statusLine('success', 'Selected drive', dataRoot));
      output.write(divider());
      return dataRoot;
    }
  }
}

async function ensureOllamaInstalled(system, prompts, { output }) {
  output.write(section('OLLAMA RUNTIME'));
  const initial = await withSpinner('Checking Ollama runtime', () => getOllamaVersion(), { output });

  if (initial.exists) {
    output.write(statusLine('success', 'Ollama runtime detected', initial.version));
    return initial.version;
  }

  if (system.isWindows) {
    const installedPath = findWindowsOllamaExecutable();

    if (installedPath) {
      output.write(statusLine('warning', 'Ollama installed but PATH missing', installedPath));
      await repairWindowsOllamaPath(installedPath, { output });
      const repaired = await withSpinner('Verifying Ollama PATH', () => getOllamaVersion(), { output });

      if (repaired.exists) {
        output.write(statusLine('success', 'Ollama runtime detected', repaired.version));
        return repaired.version;
      }

      throw new Error('Ollama is installed, but JARVIS could not run "ollama --version" after updating PATH. Close and reopen your terminal, then try again.');
    }
  }

  output.write(statusLine('warning', 'Ollama runtime', 'Not found'));
  const approved = await prompts.confirm('Ollama runtime not found. Install now?', {
    defaultValue: true,
    hint: 'JARVIS needs Ollama to run the local model core.',
  });

  if (!approved) {
    throw new Error('Setup stopped. Install Ollama later from https://ollama.com/download');
  }

  if (system.isWindows) {
    output.write(warningBox(
      'Ollama official Windows installer controls its own install location and may install on C:. JARVIS can still store its own data on your selected drive.',
    ));
    output.write(warningBox('Windows may show a UAC/admin popup during the Ollama installer.'));
    let installer = null;

    try {
      installer = await withProgress('Downloading official Ollama Windows installer', () => (
        downloadWindowsInstaller({ output: createSilentOutput() })
      ), { output, durationMs: 1800 });
      await withSpinner('Launching Ollama installer', () => runWindowsInstaller(installer), { output });
    } finally {
      if (installer) {
        await removeInstallerFile(installer);
        output.write(statusLine('success', 'Ollama installer removed', installer));
      }
    }

    const installedPath = findWindowsOllamaExecutable();

    if (installedPath) {
      await repairWindowsOllamaPath(installedPath, { output });
    }
  } else {
    output.write(warningBox('About to run: curl -fsSL https://ollama.com/install.sh | sh'));
    const runInstall = await prompts.confirm('Run official Ollama install command?', {
      defaultValue: true,
      hint: 'This uses the official Ollama install method for macOS/Linux.',
    });

    if (!runInstall) {
      throw new Error('Setup stopped before running the Ollama installer.');
    }

    await withSpinner('Running official Ollama installer', () => runUnixOllamaInstall(), { output });
  }

  const afterInstall = await withSpinner('Verifying Ollama installation', () => getOllamaVersion(), { output });

  if (!afterInstall.exists) {
    throw new Error('Ollama is still missing after install. Close and reopen your terminal, then run "ollama --version".');
  }

  output.write(statusLine('success', 'Ollama runtime detected', afterInstall.version));
  return afterInstall.version;
}

async function repairWindowsOllamaPath(installedPath, { output }) {
  const installDir = dirname(installedPath);
  const pathUpdate = await ensureWindowsPathContains(installDir);

  if (pathUpdate.userChanged) {
    output.write(statusLine('success', 'Ollama PATH saved', installDir));
    return;
  }

  if (pathUpdate.currentChanged) {
    output.write(statusLine('success', 'Ollama PATH active for setup', installDir));
    return;
  }

  output.write(statusLine('success', 'Ollama PATH already configured', installDir));
}

async function ensureOllamaServer(prompts, { output }) {
  const running = await withSpinner(
    'Checking local Ollama server',
    () => isOllamaServerRunning({ host: OLLAMA_HOST }),
    { output },
  );

  if (running) {
    output.write(statusLine('success', 'Ollama server', 'http://localhost:11434/api/tags'));
    return;
  }

  output.write(statusLine('warning', 'Ollama server', 'Not running'));
  const start = await prompts.confirm('Ollama server is not running. Start it with "ollama serve"?', {
    defaultValue: true,
    hint: 'The server must be reachable before JARVIS can inspect or pull models.',
  });

  if (!start) {
    throw new Error('Setup stopped. Start Ollama later with: ollama serve');
  }

  const pid = startOllamaServer();
  output.write(statusLine('info', 'Ollama serve launch requested', pid ? `pid ${pid}` : 'started'));
  const ready = await withSpinner(
    'Waiting for local intelligence core',
    () => waitForOllamaServer({ host: OLLAMA_HOST }),
    { output },
  );

  if (!ready) {
    throw new Error('Ollama server did not respond at http://localhost:11434/api/tags. Try running "ollama serve".');
  }

  output.write(statusLine('success', 'Ollama server', 'Online'));
}

async function ensureSelectedModel(prompts, { defaultModel, output }) {
  output.write(section('MODEL CORE'));
  const selectedModel = await prompts.select('Select local model core', [
    {
      title: `${DEFAULT_MODEL}  Recommended`,
      description: 'Gemma 4 edge model with stronger reasoning, coding, and agent workflows.',
      value: DEFAULT_MODEL,
    },
    {
      title: 'gemma4:e2b  Lightweight',
      description: 'Smaller Gemma 4 edge model for lower-memory machines.',
      value: 'gemma4:e2b',
    },
    {
      title: 'gemma4:12b  Workstation',
      description: 'Higher-capability Gemma 4 model for stronger local hardware.',
      value: 'gemma4:12b',
    },
    {
      title: 'gemma3:1b  Gemma 3 fallback',
      description: 'Older compact option when Gemma 4 is too large.',
      value: 'gemma3:1b',
    },
    {
      title: `${defaultModel}  Environment default`,
      description: 'Use JARVIS_OLLAMA_MODEL from your environment.',
      value: defaultModel,
    },
  ], { initial: 0 });

  const list = await withSpinner('Scanning installed model cores', () => getOllamaModels(), { output });

  if (!list.ok) {
    throw new Error(`Could not inspect Ollama models: ${list.output}`);
  }

  if (hasModel(list.models, selectedModel)) {
    output.write(statusLine('success', 'Model core detected', selectedModel));
    return { model: selectedModel, pulled: false };
  }

  output.write(statusLine('warning', 'Model core missing', selectedModel));
  const shouldPull = await prompts.confirm(`Model ${selectedModel} not found. Download now?`, {
    defaultValue: true,
    hint: 'Model downloads can be large and may take several minutes.',
  });

  if (!shouldPull) {
    throw new Error(`Setup stopped. Pull "${selectedModel}" later with: ollama pull ${selectedModel}`);
  }

  const result = await withProgress(`Downloading model core ${selectedModel}`, () => (
    pullModel(selectedModel, { stdio: ['ignore', 'pipe', 'pipe'] })
  ), { output, durationMs: 2500 });

  if (!result.ok) {
    throw new Error(result.stderr || `Failed to pull model "${selectedModel}".`);
  }

  output.write(statusLine('success', 'Model core downloaded', selectedModel));
  return { model: selectedModel, pulled: true };
}

async function saveConfig({ dataRoot, model, host, system, prompts, output }) {
  const configPath = join(dataRoot, 'config.json');
  await mkdir(dirname(configPath), { recursive: true });

  if (existsSync(configPath)) {
    const overwrite = await prompts.confirm(`Config already exists at ${theme.title(configPath)}. Overwrite it?`, {
      defaultValue: false,
      hint: 'Choosing no keeps your existing JARVIS configuration untouched.',
    });

    if (!overwrite) {
      output.write(statusLine('warning', 'Config unchanged', configPath));
      return null;
    }
  }

  const config = {
    name: 'JARVIS',
    model,
    host,
    dataRoot,
    createdAt: new Date().toISOString(),
    system: {
      os: system.os,
      platform: system.platform,
      arch: system.arch,
    },
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'w' });
  output.write(statusLine('success', 'Configuration saved', configPath));
  return configPath;
}

function detectWindowsDrives() {
  const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const drives = letters
    .map((letter) => validateWindowsDrive(letter))
    .filter((drive) => drive.ok)
    .map((drive) => {
      const systemDrive = drive.drive === 'C';
      const recommended = drive.drive !== 'C';

      return {
        drive: drive.drive,
        path: drive.path,
        label: systemDrive ? 'System Drive' : recommended ? 'Recommended' : 'Available',
        description: systemDrive
          ? 'Stores JARVIS data on the default Windows system drive.'
          : 'Recommended for JARVIS data/config/logs/workspace separate from the system drive.',
        recommended,
      };
    });

  if (drives.length === 0) {
    const fallback = validateWindowsDrive('C');

    if (!fallback.ok) {
      throw new Error('No available Windows drives were detected.');
    }

    return [{
      drive: fallback.drive,
      path: fallback.path,
      label: 'System Drive',
      description: 'Stores JARVIS data on the default Windows system drive.',
      recommended: true,
    }];
  }

  return drives;
}

function createSilentOutput() {
  return {
    isTTY: false,
    write() {},
  };
}
