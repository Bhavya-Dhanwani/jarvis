import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ora from 'ora';
import { playChatSequence, typewriter } from '../ui/ascii.js';
import { card, divider, section, statusLine, successBox, theme, warningBox } from '../ui/theme.js';
import { loading, withSpinner } from '../ui/spinner.js';
import { CHAT_COMMANDS } from './commands.js';

const execFileAsync = promisify(execFile);

export function createTerminalUi({ output = process.stdout, cwd = process.cwd() } = {}) {
  // Animated, collapsible renderer for the coding agent workflow.
  const coding = createCodingRenderer(output);
  // Animated, collapsing renderer for normal chat reasoning.
  const chat = createChatThinkingRenderer(output);

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
      output.write(statusLine('info', 'Ollama model', formatModelLine(modelConfig)));
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

    // Background warm-up failed. Jarvis is still usable (it warms on the first message),
    // so report it as a soft note — never as "unavailable".
    warmSkipped(reason) {
      const detail = reason ? `warms on first message (${truncate(String(reason), 60)})` : 'warms on first message';
      output.write(statusLine('warning', 'Model warm-up skipped', detail));
    },

    thinking(action) {
      return withSpinner('JARVIS is thinking', action, { output });
    },

    warming(action) {
      return withSpinner('Warming local model', action, { output });
    },

    // Start the blue thinking animation the instant the user sends a message.
    replyWaiting() {
      chat.waiting();
    },

    // Stream reasoning into the live dimmed line (collapsed later, never dumped raw).
    replyThinking(chunk) {
      chat.thinking(chunk);
    },

    // Collapse reasoning to "💭 thought for Ns" and open the answer line.
    replyAnswerStart() {
      chat.answerStart();
    },

    replyAnswerChunk(chunk) {
      chat.answerChunk(chunk);
    },

    replyEnd() {
      chat.end();
    },

    // Stop the animation when no streamed answer follows (errors / non-streamed replies).
    replyStop() {
      chat.stop();
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
      coding.handle(event);
    },

    // Blue cue marking the handoff from the multi-agent workflow to the streamed answer.
    finalizing() {
      output.write(`\n${theme.info('💭 Composing final response…')}\n`);
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

// Header model line: show per-role routing when multiple models are configured, else the
// single model. Keeps the session header honest about multi-model setups.
function formatModelLine(modelConfig) {
  const model = modelConfig?.model;

  if (!model) {
    return 'not configured';
  }

  const models = modelConfig?.models;

  if (models && (models.coding !== model || models.fast !== model)) {
    return `${models.main} ${theme.dim('· coding')} ${models.coding} ${theme.dim('· fast')} ${models.fast}`;
  }

  return model;
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

// Playful words cycled in the blue working spinner.
const WORKING_VERBS = ['Thinking', 'Cooking', 'Reasoning', 'Planning', 'Crafting', 'Wiring', 'Building', 'Polishing'];

// Normal chat-turn renderer: shows a blue animated spinner the moment a message is sent,
// surfaces streamed reasoning live as a dimmed single line, then collapses it to
// "💭 thought for Ns" once the answer begins. Falls back to plain text off a TTY.
function createChatThinkingRenderer(output) {
  const isTty = output.isTTY === true && typeof output.cursorTo === 'function';

  let spinner = null;
  let verbTimer = null;
  let verbIndex = 0;
  let startedAt = null;
  let buffer = '';
  let lastThought = '';
  let thought = false;

  const spinnerText = () => {
    const verb = theme.info(`${WORKING_VERBS[verbIndex % WORKING_VERBS.length]}…`);
    const note = lastThought ? theme.dim(` ${truncate(lastThought, 72)}`) : '';
    const secs = startedAt ? theme.dim(` ${((Date.now() - startedAt) / 1000).toFixed(0)}s`) : '';
    return `${verb}${note}${secs}`;
  };

  const refresh = () => {
    if (spinner) {
      spinner.text = spinnerText();
    }
  };

  const stopTimer = () => {
    if (verbTimer) {
      clearInterval(verbTimer);
      verbTimer = null;
    }
  };

  const elapsed = () => (startedAt ? ((Date.now() - startedAt) / 1000).toFixed(1) : '0.0');

  return {
    // Start the animation as soon as the user submits, before the model responds.
    waiting() {
      startedAt = Date.now();
      buffer = '';
      lastThought = '';
      thought = false;

      if (!isTty || spinner) {
        return;
      }

      spinner = ora({ text: spinnerText(), color: 'blue', spinner: 'dots', stream: output }).start();
      verbTimer = setInterval(() => {
        verbIndex += 1;
        refresh();
      }, 500);
    },

    // Feed streamed reasoning to the live dimmed line (kept to one line, not dumped).
    thinking(chunk) {
      thought = true;
      buffer = (buffer + chunk).slice(-240);
      const line = buffer.split('\n').map((value) => value.trim()).filter(Boolean).pop();
      lastThought = line ?? lastThought;
      refresh();
    },

    // Collapse reasoning to a single "thought for Ns" line, then open the answer.
    answerStart() {
      stopTimer();

      if (spinner) {
        if (thought) {
          spinner.stopAndPersist({ symbol: theme.info('💭'), text: theme.dim(`thought for ${elapsed()}s`) });
        } else {
          spinner.stop();
        }

        spinner = null;
      } else if (thought) {
        output.write(`${theme.dim(`💭 thought for ${elapsed()}s`)}\n`);
      }

      output.write(`\n${theme.cyan('JARVIS')} ${theme.dim('>')} `);
    },

    answerChunk(chunk) {
      output.write(chunk);
    },

    end() {
      output.write('\n');
    },

    // Stop the animation without printing an answer (errors, or a non-streamed reply).
    stop() {
      stopTimer();

      if (spinner) {
        spinner.stop();
        spinner = null;
      }
    },
  };
}

// Coding-workflow renderer. On a TTY it shows a blue animated spinner that surfaces
// live reasoning and per-file write progress, then collapses each agent to a one-line
// summary. On a non-TTY (pipes/tests) it falls back to plain status lines.
function createCodingRenderer(output) {
  // Only animate on a real terminal stream (ora needs cursor control); otherwise
  // fall back to plain status lines so pipes/tests never crash.
  const isTty = output.isTTY === true && typeof output.cursorTo === 'function';

  let spinner = null;
  let verbTimer = null;
  let verbIndex = 0;
  let agent = null; // { name, title, files, lines, activity, thinking, thinkText, thinkChars, thinkStartedAt, startedAt }

  // Live elapsed seconds for the active agent, shown so the blue spinner visibly "lives".
  const elapsed = () => (agent?.startedAt ? `${((Date.now() - agent.startedAt) / 1000).toFixed(0)}s` : '');

  // Running "N files · M lines" progress so write totals show mid-task, not only at the end.
  const progressNote = () => {
    const parts = [];
    if (agent?.files?.length) {
      parts.push(`${agent.files.length} file${agent.files.length === 1 ? '' : 's'}`);
    }
    if (agent?.lines) {
      parts.push(`${agent.lines} lines`);
    }
    return parts.join(' · ');
  };

  const spinnerText = () => {
    // While reasoning, lead with a 💭 so the streamed thinking reads as background context.
    const lead = agent?.thinking ? '💭 ' : '';
    const verb = theme.info(`${lead}${WORKING_VERBS[verbIndex % WORKING_VERBS.length]}…`);
    const who = agent ? theme.muted(` ${agent.name} · ${agent.title}`) : '';
    const detail = agent?.activity || progressNote();
    const note = detail ? theme.dim(` ${truncate(detail, 72)}`) : '';
    const time = agent?.startedAt ? theme.dim(` ${elapsed()}`) : '';
    return `${verb}${who}${note}${time}`;
  };

  const refresh = () => {
    if (spinner) {
      spinner.text = spinnerText();
    }
  };

  const startSpinner = () => {
    if (!isTty || spinner) {
      return;
    }

    spinner = ora({ text: spinnerText(), color: 'blue', spinner: 'dots', stream: output }).start();
    verbTimer = setInterval(() => {
      verbIndex += 1;
      refresh();
    }, 650);
  };

  const stopSpinner = () => {
    if (verbTimer) {
      clearInterval(verbTimer);
      verbTimer = null;
    }

    if (spinner) {
      spinner.stop();
      spinner = null;
    }
  };

  // Print a persistent line above the live spinner (keeps the spinner animating after).
  const persist = (symbol, text) => {
    if (isTty && spinner) {
      spinner.stopAndPersist({ symbol, text });
      spinner.start();
      refresh();
      return;
    }

    output.write(`${symbol ? `${symbol} ` : ''}${text}\n`);
  };

  const handle = (event) => {
    switch (event.type) {
      case 'workflow.planned': {
        stopSpinner();
        output.write('\n');
        output.write(card('IMPLEMENTATION PLAN', event.tasks.map((task, index) => [
          `${index + 1}. ${task.agent}`,
          task.title,
        ]), { borderColor: 'magenta' }));
        output.write('\n');
        return;
      }

      case 'task.started': {
        stopSpinner();
        agent = {
          name: event.task.agent,
          title: event.task.title,
          files: [],
          lines: 0,
          activity: '',
          thinking: false,
          thinkText: '',
          thinkChars: 0,
          thinkStartedAt: null,
          startedAt: Date.now(),
        };

        if (isTty) {
          startSpinner();
        } else {
          output.write('\n');
          output.write(statusLine('info', event.task.agent, event.task.title));
        }
        return;
      }

      case 'agent.thinking.started': {
        if (agent) {
          agent.thinking = true;
          agent.thinkStartedAt = Date.now();
          refresh();
        }

        if (!isTty) {
          output.write(`  ${statusLine('info', `${event.agent} reasoning`, 'thinking…')}`);
        }
        return;
      }

      case 'agent.thinking': {
        if (agent) {
          agent.thinking = true;
          agent.thinkText += event.chunk ?? '';
          // Show the latest line of reasoning live so the thinking is visible while it streams.
          agent.activity = lastLine(agent.thinkText);
          refresh();
        }
        return;
      }

      case 'agent.thinking.completed': {
        const secs = ((event.elapsedMs ?? 0) / 1000).toFixed(1);
        const gist = firstSentence(agent?.thinkText ?? '');
        const label = `${theme.muted(`${event.agent} reasoned for ${secs}s · ${event.chars ?? 0} chars`)}`;

        if (agent) {
          agent.thinking = false;
          agent.activity = '';
          agent.thinkText = '';
        }

        // Collapse the streamed reasoning into one compact line, with a short gist when present.
        persist(theme.info('💭'), gist ? `${label} ${theme.dim(`— ${truncate(gist, 80)}`)}` : label);
        return;
      }

      case 'tool.started': {
        const path = event.args?.path;

        if (agent && path) {
          agent.activity = `${event.tool === 'read_file' || event.tool === 'list_files' ? 'reading' : 'writing'} ${path}`;
          refresh();
        }

        if (!isTty) {
          output.write(`  ${statusLine('info', `${event.task.agent} tool`, `${event.tool} ${formatToolTarget(event.args)}`.trim())}`);
        }
        return;
      }

      case 'tool.completed': {
        const write = parseWriteResult(event.result, event.args?.path);

        if (write && agent) {
          agent.files.push(write.path);
          agent.lines += write.lines;
          persist(theme.success('✎'), `${theme.cyan(write.verb)} ${theme.title(write.path)} ${theme.muted(`(${write.lines} lines)`)}`);
        } else if (!isTty) {
          output.write(`  ${statusLine('success', `${event.task.agent} tool`, event.result ?? event.tool)}`);
        } else {
          persist(theme.muted('·'), theme.muted(`${event.tool}: ${truncate(String(event.result ?? '').replace(/\s+/g, ' ').trim(), 80)}`));
        }
        return;
      }

      case 'tool.failed': {
        if (isTty) {
          persist(theme.warning('⚠'), theme.muted(`${event.tool}: ${event.error.message}`));
        } else {
          output.write(`  ${statusLine('warning', `${event.task.agent} tool`, `${event.tool}: ${event.error.message}`)}`);
        }
        return;
      }

      case 'task.completed': {
        const summaryParts = [];
        if (agent?.files.length) {
          summaryParts.push(`${agent.files.length} file${agent.files.length === 1 ? '' : 's'}`);
        }
        if (agent?.lines) {
          summaryParts.push(`${agent.lines} lines`);
        }
        const tail = summaryParts.length ? theme.muted(` — ${summaryParts.join(', ')}`) : '';
        const label = `${theme.title(event.task.agent)} ${theme.dim('·')} ${theme.muted(event.task.title)}${tail}`;

        if (isTty && spinner) {
          stopSpinnerWith('✓', label);
        } else {
          stopSpinner();
          output.write(statusLine('success', event.task.agent, event.task.title));
        }

        const detail = String(event.result?.output ?? event.result?.summary ?? '').trim();
        if (detail && !agent?.files.length) {
          output.write(`${theme.muted(indent(truncate(detail, 600)))}\n`);
        }

        agent = null;
        return;
      }

      case 'quality.pass.started': {
        stopSpinner();
        output.write(statusLine('info', 'quality pass', `pass ${event.pass}`));
        return;
      }

      case 'quality.pass.completed': {
        stopSpinner();
        output.write(statusLine('success', 'quality pass', `pass ${event.pass}`));
        return;
      }

      case 'quality.rework.requested': {
        stopSpinner();
        output.write(statusLine('warning', 'quality pass', `rework requested after pass ${event.pass}`));
        return;
      }

      default: {
        stopSpinner();
        const label = event.task?.agent ?? event.type ?? 'event';
        const detail = event.error?.message ?? event.message ?? '';
        output.write(statusLine('warning', label, detail));
      }
    }
  };

  // Stop the spinner, replacing it with a persistent success line.
  function stopSpinnerWith(symbol, text) {
    if (verbTimer) {
      clearInterval(verbTimer);
      verbTimer = null;
    }

    if (spinner) {
      spinner.stopAndPersist({ symbol: theme.success(symbol), text });
      spinner = null;
    } else {
      output.write(`${symbol} ${text}\n`);
    }
  }

  return { handle };
}

// Parse a workspace write-tool result into a normalized { verb, path, lines }.
function parseWriteResult(result, fallbackPath = '') {
  const text = String(result ?? '');
  const match = text.match(/^(Wrote|Appended|Finished|Updated)\s+(?:(\d+)\s+lines\s+to\s+)?(.+?)\.?$/i);

  if (!match) {
    return null;
  }

  return {
    verb: match[1].toLowerCase(),
    lines: Number(match[2] ?? 0),
    path: (match[3] || fallbackPath).trim(),
  };
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Latest non-empty line of streamed reasoning, collapsed to a single spaced line.
function lastLine(value) {
  const lines = String(value ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

// First sentence of the reasoning, used as a compact gist when thinking collapses.
function firstSentence(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(.*?[.!?])(\s|$)/);
  return (match ? match[1] : text).trim();
}

function formatToolTarget(args = {}) {
  return args.path ? `(${args.path})` : '';
}
function indent(value) {
  return value.split('\n').map((line) => `    ${line}`).join('\n');
}

