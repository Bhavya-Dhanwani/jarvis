// Re-export the CLI runner for package consumers.
export { runCli } from './cli/index.js';
// Re-export the coding agent service for package consumers.
export {
  CodingAgentService,
  createCodingAgentService,
  getCodingWorkflowResponse,
} from './services/codingAgentService.js';
// Re-export model-driven coding intent routing.
export { CodingIntentService, createCodingIntentService } from './services/codingIntentService.js';
export {
  ensureOllamaReady,
  formatOllamaSetupRequired,
} from './services/ollamaStartupService.js';
// Re-export workspace command execution for package consumers.
export {
  WorkspaceCommandService,
  createWorkspaceCommandService,
} from './services/workspaceCommandService.js';

export {
  WorkspaceToolService,
  createWorkspaceToolService,
} from './services/workspaceToolService.js';
