// Import readline for interactive and piped chat input.
import { createInterface } from 'node:readline/promises';
// Import model config for header display.
import { createModelConfig } from './modelConfigService.js';
// Import coding workflow result validation.
import { getCodingWorkflowResponse } from './codingAgentService.js';
// Import terminal UI renderer.
import { createTerminalUi } from '../cli/terminalUi.js';

// Define slash commands that close the chat loop.
const EXIT_COMMANDS = new Set(['/exit', '/quit']);

// Run the terminal chat loop.
export class ChatLoopService {
  // Store chat loop dependencies.
  constructor({
    chatService,
    codingAgentService = null,
    codingIntentService = codingAgentService?.intentService ?? null,
    workspaceCommandService = null,
    cwd = process.cwd(),
    input = process.stdin,
    output = process.stdout,
    ui = null,
  }) {
    // Store the chat service.
    this.chatService = chatService;
    // Store optional coding workflow dependency.
    this.codingAgentService = codingAgentService;
    // Store optional model-driven intent router.
    this.codingIntentService = codingIntentService;
    // Store optional workspace command dependency.
    this.workspaceCommandService = workspaceCommandService;
    // Store the workspace where Jarvis was launched.
    this.cwd = cwd;
    // Store the input stream.
    this.input = input;
    // Store the output stream.
    this.output = output;
    // Use injected UI or create the default terminal UI.
    this.ui = ui ?? createTerminalUi({ output, cwd });
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
        this.#startBackgroundWarmAssistant();
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

  // Warm the local model without blocking the prompt.
  #startBackgroundWarmAssistant() {
    this.chatService.warmAssistant().catch((error) => {
      this.ui.unavailable(`model warm-up skipped: ${error.message}`);
    });
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

    // Keep the command list out of the startup header until requested.
    if (message === '/commands') {
      this.ui.commands?.();
      return false;
    }

    // Run the coding workflow from the active chat.
    if (message === '/code' || message.startsWith('/code ')) {
      await this.#runCodingAgent(message.slice('/code'.length).trim(), { chatId });
      return false;
    }

    // Run an explicit workspace command.
    if (message === '/run' || message.startsWith('/run ')) {
      await this.#runWorkspaceCommand(message.slice('/run'.length).trim());
      return false;
    }

    // Push Git only through an explicit slash command.
    if (message === '/git push' || message.startsWith('/git push ')) {
      await this.#gitPush(message.slice('/git push'.length).trim());
      return false;
    }

    // Let the model route workspace-changing prompts into coding mode.
    if (await this.#shouldRunCodingAgent(message)) {
      await this.#runCodingAgent(message, { chatId });
      return false;
    }

    // Save and respond to the user message.
    try {
      let streamed = false;
      let streamStarted = false;
      let thinkingStarted = false;

      // Timing instrumentation to pinpoint where latency is (set JARVIS_TIMING=0 to hide).
      const sentAt = Date.now();
      let firstReasoningAt = null;
      let firstTokenAt = null;

      // Ask the chat service to persist and generate a reply.
      const { assistantMessage } = await this.chatService.respondToUserMessage(chatId, message, {
        onThinking: (chunk) => {
          if (firstReasoningAt === null) {
            firstReasoningAt = Date.now();
          }

          if (!thinkingStarted) {
            this.ui.thinkingStart?.();
            thinkingStarted = true;
          }

          this.ui.thinkingChunk?.(chunk);
        },
        onToken: (chunk) => {
          if (firstTokenAt === null) {
            firstTokenAt = Date.now();
          }

          // Close the reasoning block once the real answer begins streaming.
          if (thinkingStarted && !streamStarted) {
            this.ui.thinkingEnd?.();
          }

          if (!streamStarted) {
            this.ui.assistantStart?.();
            streamStarted = true;
          }

          streamed = true;
          this.ui.assistantChunk?.(chunk);
        },
      });

      this.ui.timing?.({
        sentAt,
        firstReasoningAt,
        firstTokenAt,
        doneAt: Date.now(),
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

  // Run a coding request through the active workspace.
  async #runCodingAgent(request, { chatId = null } = {}) {
    if (!request) {
      this.ui.unavailable('coding request is required. Usage: /code <request>');
      return;
    }

    if (!this.codingAgentService) {
      this.ui.unavailable('coding agent is not configured.');
      return;
    }

    try {
      if (chatId) {
        this.chatService.saveUserMessage(chatId, request);
      }

      const result = await this.codingAgentService.run(request, {
        cwd: this.cwd,
        onEvent: (event) => this.ui.taskEvent?.(event),
      });
      const response = getCodingWorkflowResponse(result);

      if (chatId) {
        this.chatService.saveAssistantMessage(chatId, response);
      }

      this.ui.finalizing?.();
      await this.ui.assistant(response);
    } catch (error) {
      this.ui.unavailable(error.message);
    }
  }

  // Ask the configured model whether the prompt requires coding work.
  async #shouldRunCodingAgent(message) {
    if (!this.codingIntentService || !this.codingAgentService) {
      return false;
    }

    const decision = await this.codingIntentService.classify(message, {
      cwd: this.cwd,
    });

    return decision.intent === 'code';
  }

  // Run one explicit command in the active workspace.
  async #runWorkspaceCommand(command) {
    if (!this.workspaceCommandService) {
      this.ui.unavailable('workspace commands are not configured.');
      return;
    }

    try {
      const result = await this.workspaceCommandService.run(command);
      this.ui.commandResult?.(result);
    } catch (error) {
      this.ui.unavailable(error.message);
    }
  }

  // Push the current workspace through Git.
  async #gitPush(value) {
    if (!this.workspaceCommandService) {
      this.ui.unavailable('Git commands are not configured.');
      return;
    }

    const args = value ? value.split(/\s+/) : [];
    const result = await this.workspaceCommandService.gitPush(args);

    this.ui.commandResult?.(result);
  }
}
