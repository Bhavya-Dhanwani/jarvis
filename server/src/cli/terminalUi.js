import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { playChatSequence, typewriter } from '../ui/ascii.js';
import { card, divider, section, statusLine, successBox, theme, warningBox } from '../ui/theme.js';
import { loading, withSpinner } from '../ui/spinner.js';
import { CHAT_COMMANDS } from './commands.js';

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
      output.write('\n');
      output.write(statusLine('info', 'Commands', 'type /commands to view'));
      output.write(divider());
    },

    prompt() {
      // Leading blank line separates each turn so the chat is not visually compact.
      return `\n${theme.accent('>')} ${theme.primary('you')} ${theme.dim('>')} `;
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

    thinkingStart() {
      output.write(`\n${theme.dim('Thinking...')}\n`);
    },

    thinkingChunk(chunk) {
      // Render reasoning dimmed so it reads as background context, not the answer.
      output.write(theme.dim(chunk));
    },

    thinkingEnd() {
      output.write(`\n${theme.dim('...done thinking')}\n`);
    },

    assistantStart() {
      // Leading blank line gives the answer breathing room from the prompt/reasoning.
      output.write(`\n${theme.cyan('JARVIS')} ${theme.dim('>')} `);
    },

    assistantChunk(chunk) {
      output.write(chunk);
    },

    assistantEnd() {
      output.write('\n');
    },

    // Dim, one-line latency breakdown to pinpoint where time goes. Hide with JARVIS_TIMING=0.
    timing({ sentAt, firstReasoningAt, firstTokenAt, doneAt }) {
      if (/^(0|false|no|off)$/i.test(String(process.env.JARVIS_TIMING ?? '').trim())) {
        return;
      }

      const secs = (from, to) => (from && to ? `${((to - from) / 1000).toFixed(1)}s` : '—');
      const firstOut = firstReasoningAt ?? firstTokenAt;
      const parts = [
        `first response ${secs(sentAt, firstOut)}`,
        `first answer ${secs(sentAt, firstTokenAt)}`,
        `total ${secs(sentAt, doneAt)}`,
      ];

      output.write(`${theme.dim(`[timing] ${parts.join(' · ')}`)}\n`);
    },

    sessionSaved() {
      output.write(successBox('Session saved. Memory thread preserved.'));
    },

    commands() {
      output.write(`\n${card('JARVIS COMMANDS', CHAT_COMMANDS)}\n`);
    },

    taskEvent(event) {
      if (event.type === 'workflow.planned') {
        output.write('\n');
        output.write(card('IMPLEMENTATION PLAN', event.tasks.map((task, index) => [
          `${index + 1}. ${task.agent}`,
          task.title,
        ]), { borderColor: 'magenta' }));
        output.write('\n');
        return;
      }

      if (event.type === 'tool.started') {
        output.write(`  ${statusLine('info', `${event.task.agent} tool`, `${event.tool} ${formatToolTarget(event.args)}`.trim())}`);
        return;
      }

      if (event.type === 'tool.completed') {
        output.write(`  ${statusLine('success', `${event.task.agent} tool`, event.result ?? event.tool)}`);
        return;
      }

      if (event.type === 'tool.failed') {
        output.write(`  ${statusLine('warning', `${event.task.agent} tool`, `${event.tool}: ${event.error.message}`)}`);
        return;
      }

      if (event.type === 'task.started') {
        output.write('\n');
        output.write(statusLine('info', event.task.agent, event.task.title));
        return;
      }

      if (event.type === 'task.completed') {
        output.write(statusLine('success', event.task.agent, event.task.title));
        const detail = String(event.result?.output ?? event.result?.summary ?? '').trim();
        if (detail) {
          output.write(`${theme.muted(indent(detail))}\n`);
        }
        return;
      }

      if (event.type === 'quality.pass.started') {
        output.write(statusLine('info', 'quality pass', `pass ${event.pass}`));
        return;
      }

      if (event.type === 'quality.pass.completed') {
        output.write(statusLine('success', 'quality pass', `pass ${event.pass}`));
        return;
      }

      if (event.type === 'quality.rework.requested') {
        output.write(statusLine('warning', 'quality pass', `rework requested after pass ${event.pass}`));
        return;
      }

      const label = event.task?.agent ?? event.type ?? 'event';
      const detail = event.error?.message ?? event.message ?? '';
      output.write(statusLine('warning', label, detail));
    },

    commandResult(result) {
      const content = [result.stdout, result.stderr].filter(Boolean).join('\n');

      if (content) {
        output.write(`${content}\n`);
      }

      output.write(statusLine(
        result.status === 'completed' ? 'success' : 'warning',
        result.status === 'completed' ? 'Command completed' : 'Command failed',
        `exit ${result.exitCode}`,
      ));
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

function formatToolTarget(args = {}) {
  return args.path ? `(${args.path})` : '';
}
function indent(value) {
  return value.split('\n').map((line) => `    ${line}`).join('\n');
}

