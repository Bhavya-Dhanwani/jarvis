import { createInterface } from 'node:readline/promises';

const EXIT_COMMANDS = new Set(['/exit', '/quit']);

export class ChatLoopService {
  constructor({ chatService, input = process.stdin, output = process.stdout }) {
    this.chatService = chatService;
    this.input = input;
    this.output = output;
  }

  async run(chat, options = {}) {
    const isTerminal = this.input.isTTY === true;
    const readline = createInterface({
      input: this.input,
      output: this.output,
      terminal: isTerminal,
    });

    if (options.mode === 'resume') {
      this.output.write(`Resumed chat ${chat.id}\n`);
      this.output.write(`Loaded ${options.messageCount ?? 0} messages.\n`);
    } else {
      this.output.write(`Chat ${chat.id}\n`);
    }

    try {
      if (!isTerminal) {
        for await (const line of readline) {
          this.output.write('> ');

          if (this.#handleLine(chat.id, line)) {
            return { status: 'closed', chatId: chat.id };
          }
        }

        this.output.write('\nSession saved.\n');
        return { status: 'closed', chatId: chat.id };
      }

      while (true) {
        const line = await readline.question('> ');
        if (this.#handleLine(chat.id, line)) {
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

  #handleLine(chatId, line) {
    const message = line.trim();

    if (EXIT_COMMANDS.has(message)) {
      this.output.write('Session saved.\n');
      return true;
    }

    if (!message) {
      return false;
    }

    this.chatService.saveUserMessage(chatId, message);
    this.output.write('Saved.\n');
    return false;
  }
}
