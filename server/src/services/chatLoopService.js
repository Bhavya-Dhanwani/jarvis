// Import readline for interactive and piped chat input.
import { createInterface } from 'node:readline/promises';
// Import model config for header display.
import { createModelConfig } from './modelConfigService.js';
// Import terminal UI renderer.
import { createTerminalUi } from '../cli/terminalUi.js';

// Define slash commands that close the chat loop.
const EXIT_COMMANDS = new Set(['/exit', '/quit']);

// Run the terminal chat loop.
export class ChatLoopService {
  // Store chat loop dependencies.
  constructor({ chatService, input = process.stdin, output = process.stdout, ui = null }) {
    // Store the chat service.
    this.chatService = chatService;
    // Store the input stream.
    this.input = input;
    // Store the output stream.
    this.output = output;
    // Use injected UI or create the default terminal UI.
    this.ui = ui ?? createTerminalUi({ output });
  }

  // Start reading user input for a chat.
  async run(chat, options = {}) {
    // Detect whether input is an interactive terminal.
    const isTerminal = this.input.isTTY === true;
    // Render the chat header before reading input.
    await this.ui.renderHeader({
      // Use supplied mode or default to new chat.
      mode: options.mode ?? 'new',
      // Pass chat metadata to the header.
      chat,
      // Pass loaded message count.
      messageCount: options.messageCount ?? 0,
      // Pass model config or create one for display.
      modelConfig: options.modelConfig ?? createModelConfig(),
    });

    // Create a readline interface over the input stream.
    const readline = createInterface({
      // Use the configured input stream.
      input: this.input,
      // Use the configured output stream.
      output: this.output,
      // Enable terminal behavior only for TTY input.
      terminal: isTerminal,
    });

    // Ensure readline closes after the loop ends.
    try {
      // Use async iteration for piped input.
      if (!isTerminal) {
        // Read each piped line.
        for await (const line of readline) {
          // Echo the prompt for captured non-TTY sessions.
          this.output.write(this.ui.prompt());

          // Handle the line and close if requested.
          if (await this.#handleLine(chat.id, line)) {
            // Return a closed status.
            return { status: 'closed', chatId: chat.id };
          }
        }

        // Print a save notice when piped input ends.
        this.output.write('\nSession saved.\n');
        // Return a closed status.
        return { status: 'closed', chatId: chat.id };
      }

      if (options.modelConfig?.warmOnStart === true) {
        await this.#warmAssistant();
      }

      // Keep prompting forever in interactive mode.
      while (true) {
        // Ask for the next line.
        const line = await readline.question(this.ui.prompt());
        // Handle the line and close if requested.
        if (await this.#handleLine(chat.id, line)) {
          // Return a closed status.
          return { status: 'closed', chatId: chat.id };
        }
      }
    // Treat readline closure as a saved session.
    } catch (error) {
      // Handle Ctrl+C or stream closure.
      if (error?.code === 'ERR_USE_AFTER_CLOSE') {
        // Return a closed status.
        return { status: 'closed', chatId: chat.id };
      }

      // Print a save notice for unexpected loop exits.
      this.output.write('\nSession saved.\n');
      // Return a closed status.
      return { status: 'closed', chatId: chat.id };
    // Always close readline.
    } finally {
      // Release readline resources.
      readline.close();
    }
  }

  // Warm the local model before the first interactive prompt.
  async #warmAssistant() {
    try {
      await this.ui.warming?.(() => this.chatService.warmAssistant());
    } catch (error) {
      this.ui.unavailable(`model warm-up skipped: ${error.message}`);
    }
  }

  // Handle one user input line.
  async #handleLine(chatId, line) {
    // Trim whitespace from the entered line.
    const message = line.trim();

    // Close the loop on exit commands.
    if (EXIT_COMMANDS.has(message)) {
      // Print session saved feedback.
      this.ui.sessionSaved();
      // Tell the caller to close the loop.
      return true;
    }

    // Ignore empty lines.
    if (!message) {
      // Keep the chat loop running.
      return false;
    }

    // Save and respond to the user message.
    try {
      let streamed = false;
      let streamStarted = false;

      // Ask the chat service to persist and generate a reply.
      const { assistantMessage } = await this.chatService.respondToUserMessage(chatId, message, {
        onToken: (chunk) => {
          if (!streamStarted) {
            this.ui.assistantStart?.();
            streamStarted = true;
          }

          streamed = true;
          this.ui.assistantChunk?.(chunk);
        },
      });

      // Print assistant replies when present.
      if (assistantMessage) {
        if (streamed) {
          this.ui.assistantEnd?.();
          return false;
        }

        // Render the assistant message.
        await this.ui.assistant(assistantMessage.content);
        // Keep the chat loop running.
        return false;
      }

      // Show saved feedback when no assistant reply exists.
      this.ui.saved();
    // Keep the loop alive when the assistant is unavailable.
    } catch (error) {
      // Render the assistant error message.
      this.ui.unavailable(error.message);
    }

    // Keep the chat loop running.
    return false;
  }
}
