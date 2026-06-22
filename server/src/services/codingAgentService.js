// Import agent workflow.
import { createAgentWorkflow } from '../core/agentWorkflow.js';
// Import model configuration.
import { createModelConfig } from './modelConfigService.js';
// Import Ollama service.
import { OllamaService } from './ollamaService.js';
// Import default worker pool.
import { createDefaultWorkerPool } from '../workers/index.js';
// Import backend worker.
import { createBackendWorker } from '../workers/backend/backendWorker.js';
// Import database worker.
import { createDatabaseWorker } from '../workers/database/databaseWorker.js';
// Import frontend worker.
import { createFrontendWorker } from '../workers/frontend/frontendWorker.js';
// Import review worker.
import { createReviewWorker } from '../workers/review/reviewWorker.js';

// Define focused instructions for each coding agent.
const AGENT_INSTRUCTIONS = new Map([
  ['frontend', 'Focus on frontend implementation, user experience, accessibility, and client-side tests.'],
  ['backend', 'Focus on backend implementation, service boundaries, error handling, and server-side tests.'],
  ['database', 'Focus on schema, persistence, migrations, data integrity, and database tests.'],
  ['review', 'Review the completed agent outputs together. Identify conflicts, missing work, risks, and give one coherent final implementation response.'],
]);

// Coordinate the coding workflow with the configured local model.
export class CodingAgentService {
  // Store coding workflow dependencies.
  constructor({
    assistantService = null,
    modelConfig = null,
    workflow = null,
    env = process.env,
  } = {}) {
    // Reuse the existing model configuration and Ollama service.
    this.modelConfig = modelConfig ?? createModelConfig({ env });
    this.assistantService = assistantService ?? new OllamaService(this.modelConfig);
    // Use an injected workflow for tests or build the model-backed workflow.
    this.workflow = workflow ?? createAgentWorkflow({
      workerPool: createModelWorkerPool(this.assistantService),
    });
  }

  // Run one request through planning, workers, and review.
  async run(request, { cwd = process.cwd(), onEvent = null } = {}) {
    const scheduler = this.workflow.scheduler;
    const listeners = createSchedulerListeners(onEvent);

    for (const [event, listener] of listeners) {
      scheduler.on(event, listener);
    }

    try {
      return await this.workflow.run(request, { cwd });
    } finally {
      for (const [event, listener] of listeners) {
        scheduler.off(event, listener);
      }
    }
  }
}

// Create the coding agent service.
export function createCodingAgentService(options) {
  return new CodingAgentService(options);
}

// Build model-backed workers through the existing generic worker pool.
function createModelWorkerPool(assistantService) {
  const createRun = (agent) => async (task, context) => {
    const output = await assistantService.generateReply(createAgentMessages(agent, task, context));

    return {
      agent,
      taskId: task.id,
      output,
      summary: `${agent} agent completed ${task.title}.`,
    };
  };

  return createDefaultWorkerPool({
    frontend: createFrontendWorker({ run: createRun('frontend') }),
    backend: createBackendWorker({ run: createRun('backend') }),
    database: createDatabaseWorker({ run: createRun('database') }),
    review: createReviewWorker({ run: createRun('review') }),
  });
}

// Build compact model context for one agent task.
function createAgentMessages(agent, task, context) {
  const completedResults = agent === 'review'
    ? [...context.results.values()].map(({ agent: resultAgent, output }) => ({
      agent: resultAgent,
      output,
    }))
    : [];

  return [
    {
      role: 'system',
      content: `You are the ${agent} agent in Jarvis. ${AGENT_INSTRUCTIONS.get(agent)} Be concise, concrete, and do not claim files were changed when you only produced guidance.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        request: context.request,
        task: {
          id: task.id,
          title: task.title,
          agent: task.agent,
          dependencies: task.dependencies,
        },
        workspace: context.cwd,
        completedResults,
      }),
    },
  ];
}

// Adapt scheduler events to one optional callback.
function createSchedulerListeners(onEvent) {
  if (typeof onEvent !== 'function') {
    return new Map();
  }

  return new Map([
    ['task.started', ({ task }) => onEvent({ type: 'task.started', task })],
    ['task.completed', ({ task, result }) => onEvent({ type: 'task.completed', task, result })],
    ['task.failed', ({ task, error, retry }) => onEvent({
      type: 'task.failed',
      task,
      error,
      retry,
    })],
  ]);
}
