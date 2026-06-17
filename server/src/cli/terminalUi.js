import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function createTerminalUi({ output = process.stdout, cwd = process.cwd() } = {}) {
  const color = createColorPalette(output.isTTY === true);

  return {
    async renderHeader({ mode, chat, messageCount = 0, modelConfig }) {
      const branch = await getGitBranch(cwd);
      const title = mode === 'resume' ? `Resumed chat ${chat.id}` : `New chat ${chat.id}`;

      output.write(`${color.cyan(BANNER)}\n`);
      output.write(`${color.dim('Jarvis uses local AI. Check responses for mistakes.')}\n\n`);
      output.write(`${color.blue('*')} ${title}\n`);
      output.write(`${color.blue('*')} Messages loaded: ${messageCount}\n`);
      output.write(`${color.blue('*')} Ollama model: ${modelConfig?.model ?? 'not configured'}\n`);
      output.write(`${color.blue('*')} Commands: /exit, /quit\n\n`);
      output.write(`${color.cyan(cwd)} ${color.dim(`[${branch}]`)}\n`);
      output.write(`${color.dim('-'.repeat(72))}\n`);
    },

    prompt() {
      return `${color.cyan('>')} `;
    },

    saved() {
      output.write(`${color.dim('Saved.')}\n`);
    },

    sessionSaved() {
      output.write(`${color.green('Session saved.')}\n`);
    },

    assistant(message) {
      output.write(`${color.cyan('Jarvis')} ${color.dim('>')} ${message}\n`);
    },

    unavailable(message) {
      output.write(`${color.yellow('Jarvis unavailable:')} ${message}\n`);
    },
  };
}

const BANNER = String.raw`
     J A R V I S

     __  ___    ____ _    __ ____ _____
    / / /   |  / __ \ |  / //  _// ___/
__ / / / /| | / /_/ / | / / / /  \__ \
/ /_/ / / ___ |/ _, _/| |/ /_/ /  ___/ /
\____/_/  |_/_/ |_| |___//___/ /____/
`;

function createColorPalette(enabled) {
  if (!enabled) {
    return {
      blue: identity,
      cyan: identity,
      dim: identity,
      green: identity,
      yellow: identity,
    };
  }

  return {
    blue: wrap(34),
    cyan: wrap(36),
    dim: wrap(2),
    green: wrap(32),
    yellow: wrap(33),
  };
}

function wrap(code) {
  return (value) => `\u001b[${code}m${value}\u001b[0m`;
}

function identity(value) {
  return value;
}

async function getGitBranch(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd,
      windowsHide: true,
    });

    return stdout.trim() || 'detached';
  } catch {
    return 'no-git';
  }
}
