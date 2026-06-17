import packageInfo from '../../package.json' with { type: 'json' };
import { ChatRepository } from '../repositories/chatRepository.js';
import { MessageRepository } from '../repositories/messageRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { ChatLoopService } from '../services/chatLoopService.js';
import { ChatService } from '../services/chatService.js';
import { printHelp, printVersion } from './commands.js';
import { parseCommand } from './parser.js';

export async function runCli(args, context = {}) {
  const command = parseCommand(args);
  const output = context.output ?? console.log;

  if (command.command === 'help') {
    printHelp(output);
    return { status: 'ok' };
  }

  if (command.command === 'version') {
    printVersion(packageInfo, output);
    return { status: 'ok' };
  }

  if (command.command === 'unknown') {
    throw new Error(`${command.error}\nRun "jarvis --help" for usage.`);
  }

  if (command.command === 'new') {
    const database = context.database ?? await createRuntimeDatabase();
    const chatService = createChatService(database);
    const chatLoopService = new ChatLoopService({
      chatService,
      input: context.input,
      output: context.outputStream,
    });

    try {
      const { chat } = chatService.startNewChat();
      return await chatLoopService.run(chat);
    } finally {
      if (!context.database) {
        database.close();
      }
    }
  }

  if (command.command === 'resume') {
    output('Jarvis resume is not initialized yet.');
    return { status: 'pending', command: 'resume' };
  }

  throw new Error(`Unsupported command: ${command.command}`);
}

function createChatService(database) {
  return new ChatService({
    chatRepository: new ChatRepository(database),
    messageRepository: new MessageRepository(database),
    sessionRepository: new SessionRepository(database),
  });
}

async function createRuntimeDatabase() {
  const { createInitializedDatabase } = await import('../database/connection.js');
  return createInitializedDatabase();
}
