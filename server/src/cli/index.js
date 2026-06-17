import packageInfo from '../../package.json' with { type: 'json' };
import { ChatRepository } from '../repositories/chatRepository.js';
import { MessageRepository } from '../repositories/messageRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { NoChatSessionError } from '../core/errors.js';
import { formatSystemReport, getSystemReport } from '../core/systemCheck.js';
import { ChatLoopService } from '../services/chatLoopService.js';
import { ChatService } from '../services/chatService.js';
import { createModelConfig } from '../services/modelConfigService.js';
import { OllamaService } from '../services/ollamaService.js';
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

  if (command.command === 'doctor') {
    output(formatSystemReport(await getSystemReport()));
    return { status: 'ok', command: 'doctor' };
  }

  if (command.command === 'unknown') {
    throw new Error(`${command.error}\nRun "jarvis --help" for usage.`);
  }

  if (command.command === 'new') {
    const database = context.database ?? await createRuntimeDatabase();
    const chatService = createChatService(database, context);
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
    const database = context.database ?? await createRuntimeDatabase();
    const chatService = createChatService(database, context);
    const chatLoopService = new ChatLoopService({
      chatService,
      input: context.input,
      output: context.outputStream,
    });

    try {
      const { chat, messages } = chatService.resumeLatestChat();
      return await chatLoopService.run(chat, {
        mode: 'resume',
        messageCount: messages.length,
      });
    } catch (error) {
      if (error instanceof NoChatSessionError) {
        output(error.message);
        return { status: 'empty', command: 'resume' };
      }

      throw error;
    } finally {
      if (!context.database) {
        database.close();
      }
    }
  }

  throw new Error(`Unsupported command: ${command.command}`);
}

function createChatService(database, context = {}) {
  const modelConfig = createModelConfig();

  return new ChatService({
    chatRepository: new ChatRepository(database),
    messageRepository: new MessageRepository(database),
    sessionRepository: new SessionRepository(database),
    assistantService: context.assistantService ?? new OllamaService(modelConfig),
  });
}

async function createRuntimeDatabase() {
  const { createInitializedDatabase } = await import('../database/connection.js');
  return createInitializedDatabase();
}
