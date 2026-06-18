import packageInfo from '../../package.json' with { type: 'json' };
import { ChatRepository } from '../repositories/chatRepository.js';
import { MessageRepository } from '../repositories/messageRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { NoChatSessionError } from '../core/errors.js';
import { getSystemReport } from '../core/systemCheck.js';
import { ChatLoopService } from '../services/chatLoopService.js';
import { ChatService } from '../services/chatService.js';
import { createModelConfig } from '../services/modelConfigService.js';
import { OllamaService } from '../services/ollamaService.js';
import { runSetupWizard } from '../setup/setupWizard.js';
import { renderDoctorReport } from '../ui/doctor.js';
import { warningBox } from '../ui/theme.js';
import { printHelp, printVersion } from './commands.js';
import { parseCommand } from './parser.js';

export async function runCli(args, context = {}) {
  // Parse CLI arguments into a supported command.
  const command = parseCommand(args);
  // Use injected output for tests or console.log for normal CLI output.
  const output = context.output ?? console.log;

  // Handle help command.
  if (command.command === 'help') {
    // Print help text.
    printHelp(output);
    // Return a successful status.
    return { status: 'ok' };
  }

  // Handle version command.
  if (command.command === 'version') {
    // Print package version.
    printVersion(packageInfo, output);
    // Return a successful status.
    return { status: 'ok' };
  }

  // Handle doctor command.
  if (command.command === 'doctor') {
    // Render the themed local system readiness report.
    await renderDoctorReport({
      getReport: getSystemReport,
      output: context.outputStream ?? process.stdout,
    });
    // Return a command status for callers.
    return { status: 'ok', command: 'doctor' };
  }

  // Handle first-run setup command.
  if (command.command === 'setup') {
    // Run the interactive setup wizard.
    return runSetupWizard({
      // Pass through injected input for tests or use stdin.
      input: context.input,
      // Pass through stream output for interactive UI.
      output: context.outputStream ?? process.stdout,
      // Pass through environment overrides.
      env: context.env ?? process.env,
    });
  }

  // Handle unknown commands.
  if (command.command === 'unknown') {
    // Throw a usage-focused error.
    throw new Error(`${command.error}\nRun "jarvis --help" for usage.`);
  }

  // Handle new chat command.
  if (command.command === 'new') {
    // Open or reuse the runtime database.
    const database = context.database ?? await createRuntimeDatabase();
    // Build the chat service for persistence and model replies.
    const chatService = createChatService(database, context);
    // Build the terminal chat loop service.
    const chatLoopService = new ChatLoopService({
      // Pass the chat service into the loop.
      chatService,
      // Pass input stream into the loop.
      input: context.input,
      // Pass output stream into the loop.
      output: context.outputStream,
    });

    // Ensure a temporary runtime database is closed.
    try {
      // Create a new chat record.
      const { chat } = chatService.startNewChat();
      // Start the chat loop for that new chat.
      return await chatLoopService.run(chat);
    // Close only databases created in this function.
    } finally {
      // Keep injected test databases open for the caller.
      if (!context.database) {
        // Close the runtime database connection.
        database.close();
      }
    }
  }

  // Handle resume command.
  if (command.command === 'resume') {
    // Open or reuse the runtime database.
    const database = context.database ?? await createRuntimeDatabase();
    // Build the chat service for persistence and model replies.
    const chatService = createChatService(database, context);
    // Build the terminal chat loop service.
    const chatLoopService = new ChatLoopService({
      // Pass the chat service into the loop.
      chatService,
      // Pass input stream into the loop.
      input: context.input,
      // Pass output stream into the loop.
      output: context.outputStream,
    });

    // Resume the latest chat and handle empty history.
    try {
      // Load the latest active chat and its messages.
      const { chat, messages } = chatService.resumeLatestChat();
      // Start the chat loop in resume mode.
      return await chatLoopService.run(chat, {
        // Mark the loop as resume mode.
        mode: 'resume',
        // Show how many messages were loaded.
        messageCount: messages.length,
      });
    // Convert no-chat errors into friendly output.
    } catch (error) {
      // Check for the expected empty-history case.
      if (error instanceof NoChatSessionError) {
        // Print the friendly no-session message.
        output(warningBox(error.message));
        // Return an empty status instead of throwing.
        return { status: 'empty', command: 'resume' };
      }

      // Rethrow unexpected errors.
      throw error;
    // Close only databases created in this function.
    } finally {
      // Keep injected test databases open for the caller.
      if (!context.database) {
        // Close the runtime database connection.
        database.close();
      }
    }
  }

  // Guard against parser and handler mismatch.
  throw new Error(`Unsupported command: ${command.command}`);
}

// Build the chat service and its dependencies.
function createChatService(database, context = {}) {
  // Create the Ollama model configuration.
  const modelConfig = createModelConfig();

  // Return a chat service with repositories and assistant service wired in.
  return new ChatService({
    // Store chat metadata.
    chatRepository: new ChatRepository(database),
    // Store chat messages.
    messageRepository: new MessageRepository(database),
    // Store active session state.
    sessionRepository: new SessionRepository(database),
    // Use injected assistant for tests or Ollama for real runs.
    assistantService: context.assistantService ?? new OllamaService(modelConfig),
  });
}

// Create and initialize the runtime database lazily.
async function createRuntimeDatabase() {
  // Import database setup only when chat commands need it.
  const { createInitializedDatabase } = await import('../database/connection.js');
  // Return the initialized database connection.
  return createInitializedDatabase();
}
