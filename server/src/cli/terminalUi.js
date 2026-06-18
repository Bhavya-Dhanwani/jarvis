// Import execFile to inspect git without shell parsing.
import { execFile } from 'node:child_process';
// Import promisify to use execFile with async/await.
import { promisify } from 'node:util';

// Create a promise-based execFile helper.
const execFileAsync = promisify(execFile);

// Create terminal rendering helpers for chat mode.
export function createTerminalUi({ output = process.stdout, cwd = process.cwd() } = {}) {
  // Enable colors only for interactive terminals.
  const color = createColorPalette(output.isTTY === true);

  // Return UI rendering methods used by the chat loop.
  return {
    // Render the header shown before chat input starts.
    async renderHeader({ mode, chat, messageCount = 0, modelConfig }) {
      // Read the current git branch for context.
      const branch = await getGitBranch(cwd);
      // Choose the header title based on chat mode.
      const title = mode === 'resume' ? `Resumed chat ${chat.id}` : `New chat ${chat.id}`;

      // Print the JARVIS banner.
      output.write(`${color.cyan(BANNER)}\n`);
      // Print a local-AI caution line.
      output.write(`${color.dim('Jarvis uses local AI. Check responses for mistakes.')}\n\n`);
      // Print the chat title.
      output.write(`${color.blue('*')} ${title}\n`);
      // Print loaded message count.
      output.write(`${color.blue('*')} Messages loaded: ${messageCount}\n`);
      // Print selected model.
      output.write(`${color.blue('*')} Ollama model: ${modelConfig?.model ?? 'not configured'}\n`);
      // Print available slash commands.
      output.write(`${color.blue('*')} Commands: /exit, /quit\n\n`);
      // Print working directory and git branch.
      output.write(`${color.cyan(cwd)} ${color.dim(`[${branch}]`)}\n`);
      // Print a separator line.
      output.write(`${color.dim('-'.repeat(72))}\n`);
    },

    // Return the prompt displayed before user input.
    prompt() {
      // Return a colored prompt marker.
      return `${color.cyan('>')} `;
    },

    // Show that a message was saved without an assistant reply.
    saved() {
      // Print a dim saved notice.
      output.write(`${color.dim('Saved.')}\n`);
    },

    // Show that the chat session was saved.
    sessionSaved() {
      // Print a green session saved notice.
      output.write(`${color.green('Session saved.')}\n`);
    },

    // Print an assistant message.
    assistant(message) {
      // Print the Jarvis label and response.
      output.write(`${color.cyan('Jarvis')} ${color.dim('>')} ${message}\n`);
    },

    // Print an assistant unavailable message.
    unavailable(message) {
      // Print a yellow error prefix and message.
      output.write(`${color.yellow('Jarvis unavailable:')} ${message}\n`);
    },
  };
}

// Store the chat-mode ASCII banner.
const BANNER = String.raw`
     J A R V I S

     __  ___    ____ _    __ ____ _____
    / / /   |  / __ \ |  / //  _// ___/
__ / / / /| | / /_/ / | / / / /  \__ \
/ /_/ / / ___ |/ _, _/| |/ /_/ /  ___/ /
\____/_/  |_/_/ |_| |___//___/ /____/
`;

// Create ANSI color wrappers when enabled.
function createColorPalette(enabled) {
  // Return identity functions when colors are disabled.
  if (!enabled) {
    // Keep all text uncolored for non-TTY output.
    return {
      // Leave blue text unchanged.
      blue: identity,
      // Leave cyan text unchanged.
      cyan: identity,
      // Leave dim text unchanged.
      dim: identity,
      // Leave green text unchanged.
      green: identity,
      // Leave yellow text unchanged.
      yellow: identity,
    };
  }

  // Return ANSI color functions for TTY output.
  return {
    // Blue ANSI wrapper.
    blue: wrap(34),
    // Cyan ANSI wrapper.
    cyan: wrap(36),
    // Dim ANSI wrapper.
    dim: wrap(2),
    // Green ANSI wrapper.
    green: wrap(32),
    // Yellow ANSI wrapper.
    yellow: wrap(33),
  };
}

// Create an ANSI wrapper for a numeric color code.
function wrap(code) {
  // Return a function that wraps text in ANSI escape codes.
  return (value) => `\u001b[${code}m${value}\u001b[0m`;
}

// Return text unchanged.
function identity(value) {
  // Pass through the input value.
  return value;
}

// Read the current git branch for display.
async function getGitBranch(cwd) {
  // Try to ask git for the current branch.
  try {
    // Run git branch --show-current without shell parsing.
    const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
      // Run git inside the CLI working directory.
      cwd,
      // Hide extra Windows console windows.
      windowsHide: true,
    });

    // Return the branch name or detached fallback.
    return stdout.trim() || 'detached';
  // Return no-git if git is unavailable or cwd is not a repo.
  } catch {
    // Hide git errors from normal chat startup.
    return 'no-git';
  }
}
