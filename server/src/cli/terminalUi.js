import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { playChatSequence, typewriter } from '../ui/ascii.js';
import { card, divider, section, statusLine, successBox, theme, warningBox } from '../ui/theme.js';
import { loading, withSpinner } from '../ui/spinner.js';

const execFileAsync = promisify(execFile);

export function createTerminalUi({ output = process.stdout, cwd = process.cwd() } = {}) {
  return {
    async renderHeader({ mode, chat, messageCount = 0, modelConfig }) {
      const isTty = output.isTTY === true;
      const branch = await withSpinner('Resolving workspace context', () => getGitBranch(cwd), { output });
      const title = mode === 'resume' ? 'SESSION RESTORED' : 'NEW SESSION ONLINE';

      if (isTty) {
        await playChatSequence({ output, mode });
        await loading('Synchronizing memory buffers', { output, durationMs: 500 });
      } else {
        output.write(`Jarvis ${mode === 'resume' ? 'resume' : 'chat'}\n`);
      }

      output.write(section('SESSION CORE'));
      output.write(statusLine('success', title, chat.id));
      output.write(`${theme.info('i')} ${theme.title('Messages loaded')}: ${messageCount}\n`);
      output.write(statusLine('info', 'Ollama model', modelConfig?.model ?? 'not configured'));
      output.write(statusLine('info', 'Workspace', cwd));
      output.write(statusLine('info', 'Git branch', branch));
      output.write(card('COMMANDS', [
        ['/exit', 'Save and close session'],
        ['/quit', 'Save and close session'],
      ], { borderColor: mode === 'resume' ? 'magenta' : 'cyan' }));
      output.write('\n');
      output.write(divider());
    },

    prompt() {
      return `${theme.accent('>')} ${theme.primary('you')} ${theme.dim('>')} `;
    },

    saved() {
      output.write(statusLine('success', 'Saved', 'message persisted locally'));
    },

    thinking(action) {
      return withSpinner('JARVIS is thinking', action, { output });
    },

    warming(action) {
      return withSpinner('Warming local model', action, { output });
    },

    assistantStart() {
      output.write(`${theme.cyan('JARVIS')} ${theme.dim('>')} `);
    },

    assistantChunk(chunk) {
      output.write(chunk);
    },

    assistantEnd() {
      output.write('\n');
    },

    sessionSaved() {
      output.write(successBox('Session saved. Memory thread preserved.'));
    },

    async assistant(message) {
      output.write(`${theme.cyan('JARVIS')} ${theme.dim('>')} `);

      if (!output.isTTY) {
        output.write(`${message}\n`);
        return;
      }

      await typewriter(message, { output, speed: 8 });
    },

    unavailable(message) {
      output.write(warningBox(`Jarvis unavailable: ${message}`));
    },
  };
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
