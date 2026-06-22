import packageInfo from '../../package.json' with { type: 'json' };
import { ChatRepository } from '../repositories/chatRepository.js';
import { MessageRepository } from '../repositories/messageRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { NoChatSessionError } from '../core/errors.js';
import { getSystemReport } from '../core/systemCheck.js';
import { ChatLoopService } from '../services/chatLoopService.js';
import { ChatService } from '../services/chatService.js';
import { createCodingAgentService } from '../services/codingAgentService.js';
import { createModelConfig } from '../services/modelConfigService.js';
import { OllamaService } from '../services/ollamaService.js';
import { createWorkspaceCommandService } from '../services/workspaceCommandService.js';
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

  // Handle coding agent command.
  if (command.command === 'code') {
    // Join command arguments into one coding request.
    const request = command.args.join(' ').trim();

    // Require a request so the planner has meaningful input.
    if (!request) {
      throw new Error('Coding request is required.\nUsage: jarvis code "<request>"');
    }

    // Reuse an injected coding service or build the Ollama-backed workflow.
    const codingAgentService = context.codingAgentService ?? createCodingAgentService({
      assistantService: context.assistantService,
      env: context.env ?? process.env,
    });

    // Run the planner, workers, and review pipeline.
    const result = await codingAgentService.run(request, {
      cwd: context.cwd ?? process.cwd(),
      onEvent: (event) => renderCodingEvent(event, output),
    });
    // Load the final review result.
    const review = result.results.get('review-task');

    // Print the reviewed response after task progress.
    output(review?.output ?? review?.summary ?? 'Coding workflow completed without a review response.');

    // Return command details for callers and tests.
    return {
      status: result.status,
      command: 'code',
      result,
    };
  }

  // Handle new chat command.
  if (command.command === 'new') {
    // Open or reuse the runtime database.
    const database = context.database ?? await createRuntimeDatabase();
    // Resolve the model once so display and requests stay aligned.
    const modelConfig = createModelConfig({ env: context.env ?? process.env });
    // Build the chat service for persistence and model replies.
    const chatService = createChatService(database, { ...context, modelConfig });
    // Build the terminal chat loop service.
    const chatLoopService = createChatLoopService(chatService, context);

    // Ensure a temporary runtime database is closed.
    try {
      // Create a new chat record.
      const { chat } = chatService.startNewChat();
      // Start the chat loop for that new chat.
      return await chatLoopService.run(chat, { modelConfig });
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
    // Resolve the model once so display and requests stay aligned.
    const modelConfig = createModelConfig({ env: context.env ?? process.env });
    // Build the chat service for persistence and model replies.
    const chatService = createChatService(database, { ...context, modelConfig });
    // Build the terminal chat loop service.
    const chatLoopService = createChatLoopService(chatService, context);

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
        // Show the same model config used by the Ollama service.
        modelConfig,
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

// Render coding workflow events through line output.
function renderCodingEvent(event, output) {
  if (event.type === 'task.started') {
    output(`[started] ${event.task.agent}: ${event.task.title}`);
    return;
  }

  if (event.type === 'task.completed') {
    output(`[completed] ${event.task.agent}: ${event.task.title}`);
    return;
  }

  output(`[failed] ${event.task.agent}: ${event.error.message}${event.retry ? ' (retrying)' : ''}`);
}

// Build the interactive chat loop with workspace tools.
function createChatLoopService(chatService, context = {}) {
  const cwd = context.cwd ?? process.cwd();
  const codingAgentService = context.codingAgentService ?? createCodingAgentService({
    assistantService: context.assistantService,
    env: context.env ?? process.env,
  });
  const workspaceCommandService = context.workspaceCommandService
    ?? createWorkspaceCommandService({ cwd });

  return new ChatLoopService({
    chatService,
    codingAgentService,
    workspaceCommandService,
    cwd,
    input: context.input,
    output: context.outputStream,
  });
}

// Build the chat service and its dependencies.
function createChatService(database, context = {}) {
  // Create the Ollama model configuration.
  const modelConfig = context.modelConfig ?? createModelConfig({ env: context.env ?? process.env });

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
