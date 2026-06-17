import { createInterface } from 'node:readline/promises';
import { createModelConfig } from './modelConfigService.js';
import { createTerminalUi } from '../cli/terminalUi.js';

const EXIT_COMMANDS = new Set(['/exit', '/quit']);

export class ChatLoopService {
  constructor({ chatService, input = process.stdin, output = process.stdout, ui = null }) {
    this.chatService = chatService;
    this.input = input;
    this.output = output;
    this.ui = ui ?? createTerminalUi({ output });
  }

  async run(chat, options = {}) {
    const isTerminal = this.input.isTTY === true;
    await this.ui.renderHeader({
      mode: options.mode ?? 'new',
      chat,
      messageCount: options.messageCount ?? 0,
      modelConfig: options.modelConfig ?? createModelConfig(),
    });

    const readline = createInterface({
      input: this.input,
      output: this.output,
      terminal: isTerminal,
    });

    try {
      if (!isTerminal) {
        for await (const line of readline) {
          this.output.write(this.ui.prompt());

          if (await this.#handleLine(chat.id, line)) {
            return { status: 'closed', chatId: chat.id };
          }
        }

        this.output.write('\nSession saved.\n');
        return { status: 'closed', chatId: chat.id };
      }

      while (true) {
        const line = await readline.question(this.ui.prompt());
        if (await this.#handleLine(chat.id, line)) {
          return { status: 'closed', chatId: chat.id };
        }
      }
    } catch (error) {
      if (error?.code === 'ERR_USE_AFTER_CLOSE') {
        return { status: 'closed', chatId: chat.id };
      }

      this.output.write('\nSession saved.\n');
      return { status: 'closed', chatId: chat.id };
    } finally {
      readline.close();
    }
  }

  async #handleLine(chatId, line) {
    const message = line.trim();

    if (EXIT_COMMANDS.has(message)) {
      this.ui.sessionSaved();
      return true;
    }

    if (!message) {
      return false;
    }

    try {
      const { assistantMessage } = await this.chatService.respondToUserMessage(chatId, message);

      if (assistantMessage) {
        this.ui.assistant(assistantMessage.content);
        return false;
      }

      this.ui.saved();
    } catch (error) {
      this.ui.unavailable(error.message);
    }

    return false;
  }
}
