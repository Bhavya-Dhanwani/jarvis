import packageInfo from '../../package.json' with { type: 'json' };
import { ChatRepository } from '../repositories/chatRepository.js';
import { MessageRepository } from '../repositories/messageRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { NoChatSessionError } from '../core/errors.js';
import { getSystemReport } from '../core/systemCheck.js';
import { ChatLoopService } from '../services/chatLoopService.js';
import { ChatService } from '../services/chatService.js';
import {
  createCodingAgentService,
  getCodingWorkflowResponse,
} from '../services/codingAgentService.js';
import { createModelConfig } from '../services/modelConfigService.js';
import {
  ensureOllamaReady,
  formatOllamaSetupRequired,
} from '../services/ollamaStartupService.js';
import { OllamaService } from '../services/ollamaService.js';
import { createWorkspaceCommandService } from '../services/workspaceCommandService.js';
import { runChangeWizard, runSetupWizard } from '../setup/setupWizard.js';
import {
  claimOllamaUrl,
  publishOllamaUrl,
  refreshAccessToken,
} from '../services/authClientService.js';
import { startBestTunnel } from '../services/tunnelService.js';
import {
  RUNTIME_MODES,
  loadAuth,
  loadJarvisConfig,
  saveJarvisConfig,
} from '../services/runtimeModeService.js';
import { renderDoctorReport } from '../ui/doctor.js';
import { card, errorBox, statusLine, successBox, warningBox } from '../ui/theme.js';
import { printCommands, printHelp, printVersion } from './commands.js';
import { parseCommand } from './parser.js';

const DEFAULT_CLIENT_URL_POLL_INTERVAL_MS = 3000;
const DEFAULT_HOST_REPUBLISH_INTERVAL_MS = 30000;

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

  // Show commands available in an interactive Jarvis session.
  if (command.command === 'commands') {
    printCommands(output);
    return { status: 'ok', command: 'commands' };
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

  // Handle runtime mode changes.
  if (command.command === 'change') {
    return runChangeWizard({
      input: context.input,
      output: context.outputStream ?? process.stdout,
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

    // Resolve client URLs before building any model-backed service.
    const { modelConfig, readiness } = await resolveReadyRuntimeConfig({
      context,
      output,
      command: 'code',
    });

    if (!readiness.ready) {
      output(warningBox(formatOllamaSetupRequired(readiness, modelConfig)));
      return { status: 'setup-required', command: 'code', readiness };
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
    // Print the reviewed response or surface the task that actually failed.
    output(getCodingWorkflowResponse(result));

    // Return command details for callers and tests.
    return {
      status: result.status,
      command: 'code',
      result,
    };
  }

  // Handle new chat command.
  if (command.command === 'new') {
    const hostResult = await handleHostPublisherRuntime(context);

    if (hostResult) {
      return hostResult;
    }

    // Open or reuse the runtime database.
    const database = context.database ?? await createRuntimeDatabase();
    // Resolve the model once so display and requests stay aligned.
    const { modelConfig, readiness } = await resolveReadyRuntimeConfig({
      context,
      output,
      command: command.command,
    });

    if (!readiness.ready) {
      output(warningBox(formatOllamaSetupRequired(readiness, modelConfig)));
      return { status: 'setup-required', command: 'new', readiness };
    }

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
    const { modelConfig, readiness } = await resolveReadyRuntimeConfig({
      context,
      output,
      command: command.command,
    });

    if (!readiness.ready) {
      output(warningBox(formatOllamaSetupRequired(readiness, modelConfig)));
      return { status: 'setup-required', command: 'resume', readiness };
    }

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

export function renderCliError(error) {
  const message = error?.message || 'Jarvis failed with an unknown error.';
  const detail = normalizeCliErrorMessage(message);

  return errorBox(detail);
}

function normalizeCliErrorMessage(message) {
  if (/^Client mode needs auth\./.test(message)) {
    return [
      'Client mode is missing saved auth.',
      '',
      'Run `jarvis setup` or `jarvis change` and login again.',
      'If you selected a custom data drive, Jarvis will now look beside that config automatically.',
    ].join('\n');
  }

  if (/^Host mode needs auth\./.test(message)) {
    return [
      'Host mode is missing saved auth.',
      '',
      'Run `jarvis setup` or `jarvis change`, choose Host mode, and login again.',
    ].join('\n');
  }

  if (/^URL not available\./.test(message)) {
    return [
      'No temporary host URL is available yet.',
      '',
      'Start Jarvis in Host mode on the machine running Ollama, then run this command again.',
    ].join('\n');
  }

  if (/fetch failed/i.test(message)) {
    return [
      'Jarvis could not reach the configured server.',
      '',
      'Check that the signaling server URL is correct and reachable, then run `jarvis setup` or `jarvis change` again if needed.',
    ].join('\n');
  }

  return message;
}

async function handleHostPublisherRuntime(context = {}) {
  const env = context.env ?? process.env;
  const config = loadJarvisConfig({ env });

  if (config?.mode !== RUNTIME_MODES.HOST) {
    return null;
  }

  const output = context.output ?? console.log;
  const outputStream = context.outputStream ?? process.stdout;
  const modelConfig = createModelConfig({ env });
  const tunnelLocalUrl = await resolveLocalOllamaTunnelTarget(modelConfig.host, context);
  const hostModelConfig = { ...modelConfig, host: tunnelLocalUrl };
  const readiness = await checkOllamaReadiness(hostModelConfig, context);

  if (!readiness.ready) {
    output(warningBox(formatOllamaSetupRequired(readiness, hostModelConfig)));
    return { status: 'setup-required', command: 'host', readiness };
  }

  const auth = loadAuth({ env });

  if (!auth?.refreshToken || !auth?.serverUrl) {
    throw new Error('Host mode needs auth. Run "jarvis setup" or "jarvis change" and login first.');
  }

  const refresh = context.refreshAccessToken ?? refreshAccessToken;
  const publish = context.publishOllamaUrl ?? publishOllamaUrl;
  const openTunnel = context.startBestTunnel ?? startBestTunnel;
  const accessToken = await refresh({
    serverUrl: auth.serverUrl,
    refreshToken: auth.refreshToken,
  });
  const tunnel = await openTunnel({
    localUrl: tunnelLocalUrl,
    output: outputStream,
    dataRoot: config.dataRoot,
    // Let the tunnel layer discard a technique whose public URL doesn't route back
    // to Ollama (e.g. cloudflared when QUIC is blocked) and fall through to the next.
    verify: context.verifyPublishedTunnel === false
      ? undefined
      : (url) => isTunnelRoutingToOllama({ context, modelConfig: { ...modelConfig, host: url } }),
  });

  const tunnelVerified = await waitForPublishedTunnelReady({
    context,
    output,
    modelConfig: { ...modelConfig, host: tunnel.url },
  });

  if (!tunnelVerified) {
    tunnel.process?.kill?.();
    return {
      status: 'tunnel-unreachable',
      command: 'host',
      mode: RUNTIME_MODES.HOST,
      publishedUrl: null,
    };
  }

  await publish({
    serverUrl: auth.serverUrl,
    accessToken,
    ollamaUrl: tunnel.url,
  });

  output(successBox('Host mode is online. Temporary Ollama URL published to the server.'));
  output(statusLine('success', 'Published URL', tunnel.url));
  output(card('HOST LINK', [
    ['Server', auth.serverUrl],
    ['Provider', tunnel.provider],
    ['Ollama URL', tunnel.url],
  ], { borderColor: 'green' }));

  const result = {
    status: 'ok',
    command: 'host',
    mode: RUNTIME_MODES.HOST,
    publishedUrl: tunnel.url,
  };

  if (shouldKeepHostOnline(context)) {
    await keepHostPublisherOnline({
      context,
      output,
      publish,
      serverUrl: auth.serverUrl,
      accessToken,
      tunnel,
    });
  }

  return result;
}

async function resolveLocalOllamaTunnelTarget(host, context = {}) {
  const candidates = buildLocalOllamaCandidates(host);
  const checker = context.ensureOllamaReady ?? ensureOllamaReady;

  for (const candidate of candidates) {
    const readiness = await checker({
      modelConfig: {
        ...createModelConfig({ env: context.env ?? process.env }),
        host: candidate,
      },
      ...(context.ollamaStartupOptions ?? {}),
      allowLocalStart: false,
    });

    if (readiness.ready) {
      return candidate;
    }
  }

  return candidates[0] ?? 'http://localhost:11434';
}

function buildLocalOllamaCandidates(host) {
  const candidates = [];
  const add = (value) => {
    const normalized = normalizeUrl(value);

    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  add(host);
  add(rewriteHostname(host, 'localhost'));
  add(rewriteHostname(host, '127.0.0.1'));
  add('http://localhost:11434');
  add('http://127.0.0.1:11434');

  return candidates;
}

function rewriteHostname(host, hostname) {
  try {
    const parsed = new URL(host);
    parsed.hostname = hostname;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeUrl(value) {
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

// Probe Ollama once through a candidate public URL; used by the tunnel layer to
// pick the first technique that actually routes back to this machine.
async function isTunnelRoutingToOllama({ context, modelConfig }) {
  const readiness = await checkOllamaReadiness(modelConfig, {
    ...context,
    ollamaStartupOptions: {
      ...(context.ollamaStartupOptions ?? {}),
      allowLocalStart: false,
      timeoutMs: context.hostTunnelVerifyTimeoutMs ?? 6000,
      pollIntervalMs: 250,
    },
  });

  return readiness.ready === true;
}

async function waitForPublishedTunnelReady({ context, output, modelConfig }) {
  if (context.verifyPublishedTunnel === false) {
    return true;
  }

  const keepWaiting = shouldKeepHostTunnelWaiting(context);
  const maxAttempts = keepWaiting ? Infinity : (context.hostTunnelVerifyMaxAttempts ?? 8);
  const pollIntervalMs = context.hostTunnelVerifyPollIntervalMs ?? 1000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const readiness = await checkOllamaReadiness(modelConfig, {
      ...context,
      ollamaStartupOptions: {
        ...(context.ollamaStartupOptions ?? {}),
        allowLocalStart: false,
        timeoutMs: context.hostTunnelVerifyTimeoutMs ?? 6000,
        pollIntervalMs: 250,
      },
    });

    if (readiness.ready) {
      output(statusLine('success', 'Public Ollama tunnel verified', modelConfig.host));
      return true;
    }

    const detail = readiness.reason
      ? `${readiness.reason} (attempt ${attempt})`
      : 'keeping tunnel open until Ollama is reachable';
    output(statusLine('warning', 'Public tunnel not ready', detail));
    await wait(pollIntervalMs);
  }

  output(warningBox([
    'The host tunnel URL was created, but Jarvis could not reach Ollama through it.',
    '',
    'Jarvis did not publish this broken URL. Keep this host command open and fix local Ollama or the tunnel, then run host again.',
    `Unverified host: ${modelConfig.host}`,
  ].join('\n')));
  return false;
}

function shouldKeepHostTunnelWaiting(context = {}) {
  if (typeof context.hostTunnelKeepWaiting === 'boolean') {
    return context.hostTunnelKeepWaiting;
  }

  return shouldKeepHostOnline(context);
}
async function keepHostPublisherOnline({ context, output, publish, serverUrl, accessToken, tunnel }) {
  const intervalMs = context.hostRepublishIntervalMs ?? DEFAULT_HOST_REPUBLISH_INTERVAL_MS;

  output(statusLine('info', 'Host link', 'keeping tunnel published; press Ctrl+C to stop'));

  await new Promise((resolve) => {
    let stopped = false;
    let timer = null;

    const stop = () => {
      if (stopped) {
        return;
      }

      stopped = true;
      clearTimeout(timer);
      tunnel.process?.kill?.();
      output(statusLine('warning', 'Host link stopped', 'tunnel process closed'));
      resolve();
    };

    const tick = async () => {
      if (stopped) {
        return;
      }

      try {
        await publish({
          serverUrl,
          accessToken,
          ollamaUrl: tunnel.url,
        });
        output(statusLine('success', 'Host URL refreshed', tunnel.url));
      } catch (error) {
        output(statusLine('warning', 'Host refresh failed', error.message));
      }

      timer = setTimeout(tick, intervalMs);
    };

    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    timer = setTimeout(tick, intervalMs);
  });
}

function shouldKeepHostOnline(context = {}) {
  if (typeof context.hostKeepAlive === 'boolean') {
    return context.hostKeepAlive;
  }

  const outputStream = context.outputStream ?? process.stdout;
  return outputStream.isTTY === true;
}
export async function prepareRuntimeConfig(context = {}) {
  const env = context.env ?? process.env;
  const config = loadJarvisConfig({ env });

  if (config?.mode !== RUNTIME_MODES.CLIENT) {
    return config;
  }

  if (context.assistantService
    || context.codingAgentService
    || context.database
    || context.ensureOllamaReady) {
    return config;
  }

  const auth = loadAuth({ env });

  if (!auth?.refreshToken || !auth?.serverUrl) {
    throw new Error('Client mode needs auth. Run "jarvis setup" or "jarvis change" and login first.');
  }

  const refresh = context.refreshAccessToken ?? refreshAccessToken;
  const claim = context.claimOllamaUrl ?? claimOllamaUrl;
  const output = context.output ?? console.log;
  const keepWaiting = shouldKeepClientWaiting(context);
  const maxAttempts = keepWaiting ? Infinity : (context.clientUrlMaxAttempts ?? 1);
  const pollIntervalMs = context.clientUrlPollIntervalMs ?? DEFAULT_CLIENT_URL_POLL_INTERVAL_MS;
  const accessToken = await refresh({
    serverUrl: auth.serverUrl,
    refreshToken: auth.refreshToken,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const claimed = await claim({
        serverUrl: auth.serverUrl,
        accessToken,
      });
      const url = claimed.data?.url;

      if (url) {
        await saveJarvisConfig({
          dataRoot: config.dataRoot,
          mode: RUNTIME_MODES.CLIENT,
          model: config.model,
          host: url,
          signalingServerUrl: auth.serverUrl,
          remoteHostTemporary: true,
        });

        return { ...config, host: url };
      }

      if (attempt >= maxAttempts) {
        throw new Error('URL not available. Waiting for the host to provide one. Start the host, then run Jarvis again.');
      }

      output(statusLine('warning', 'URL not available', 'waiting for the host to publish one'));
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      output(statusLine('warning', 'Server claim failed', error.message));
    }

    await wait(pollIntervalMs);
  }

  return config;
}

async function resolveReadyRuntimeConfig({ context, output, command }) {
  const keepWaiting = shouldKeepClientWaiting(context);
  const maxAttempts = keepWaiting ? Infinity : (context.remoteOllamaMaxAttempts ?? 1);
  const pollIntervalMs = context.remoteOllamaPollIntervalMs ?? DEFAULT_CLIENT_URL_POLL_INTERVAL_MS;
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await prepareRuntimeConfig(context);
    const modelConfig = createModelConfig({ env: context.env ?? process.env });
    const readiness = await checkOllamaReadiness(modelConfig, context);

    if (readiness.ready) {
      return { modelConfig, readiness };
    }

    last = { modelConfig, readiness };

    if (!readiness.remote || attempt >= maxAttempts) {
      return last;
    }

    if (attempt === 1) {
      output(warningBox(formatOllamaSetupRequired(readiness, modelConfig)));
    }

    output(statusLine('warning', 'Remote Ollama unreachable', 'waiting for host to republish a working URL'));
    await wait(pollIntervalMs);
  }

  return last ?? {
    modelConfig: createModelConfig({ env: context.env ?? process.env }),
    readiness: { ready: false, reason: `Jarvis could not prepare runtime for ${command}.` },
  };
}

function shouldKeepClientWaiting(context = {}) {
  if (typeof context.clientKeepAlive === 'boolean') {
    return context.clientKeepAlive;
  }

  const outputStream = context.outputStream ?? process.stdout;
  return outputStream.isTTY === true;
}

async function checkOllamaReadiness(modelConfig, context = {}) {
  if (context.skipOllamaStartupCheck === true
    || context.assistantService
    || context.codingAgentService) {
    return { ready: true, skipped: true };
  }

  const checker = context.ensureOllamaReady ?? ensureOllamaReady;

  return checker({
    modelConfig,
    ...(context.ollamaStartupOptions ?? {}),
  });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
// Render coding workflow events through line output.
function renderCodingEvent(event, output) {
  if (event.type === 'workflow.planned') {
    output('');
    output(`[plan] ${event.tasks.map((task) => `${task.agent}: ${task.title}`).join(' -> ')}`);
    return;
  }

  if (event.type === 'tool.started') {
    output(`  [tool] ${event.task.agent}: ${event.tool}${event.args?.path ? ` (${event.args.path})` : ''}`);
    return;
  }

  if (event.type === 'tool.completed') {
    output(`  [tool completed] ${event.task.agent}: ${event.tool}${event.result ? ` - ${event.result}` : ''}`);
    return;
  }

  if (event.type === 'tool.failed') {
    output(`  [tool failed] ${event.task.agent}: ${event.tool}: ${event.error.message}`);
    return;
  }

  if (event.type === 'task.started') {
    output('');
    output(`[started] ${event.task.agent}: ${event.task.title}`);
    return;
  }

  if (event.type === 'task.completed') {
    output(`[completed] ${event.task.agent}: ${event.task.title}`);
    const detail = String(event.result?.output ?? event.result?.summary ?? '').trim();
    if (detail) {
      output(`  ${detail}`);
    }
    return;
  }

  if (event.type === 'quality.pass.started') {
    output(`[quality] pass ${event.pass} started`);
    return;
  }

  if (event.type === 'quality.pass.completed') {
    output(`[quality] pass ${event.pass} completed`);
    return;
  }

  if (event.type === 'quality.rework.requested') {
    output(`[quality] rework requested after pass ${event.pass}`);
    return;
  }

  output(`[event] ${event.type ?? 'unknown'}${event.error?.message ? `: ${event.error.message}` : ''}`);
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
