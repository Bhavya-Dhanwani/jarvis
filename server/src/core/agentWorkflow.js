// Import planner.
import { createPlannerAgent } from '../agents/planner/plannerAgent.js';
// Import scheduler.
import { TaskScheduler } from '../scheduler/taskScheduler.js';
// Import default workers.
import { createDefaultWorkerPool } from '../workers/index.js';

// Coordinate request planning, scheduling, worker execution, and review.
export class AgentWorkflow {
  // Store workflow dependencies.
  constructor({
    planner = createPlannerAgent(),
    workerPool = createDefaultWorkerPool(),
    scheduler = null,
  } = {}) {
    // Store planner.
    this.planner = planner;
    // Store worker pool.
    this.workerPool = workerPool;
    // Store scheduler.
    this.scheduler = scheduler ?? new TaskScheduler({ workerPool });
  }

  // Run a request through the agent workflow.
  async run(request, context = {}) {
    const taskGraph = this.planner.plan(request);
    const results = new Map();
    const runContext = {
      ...context,
      request,
      results,
    };

    const recordResult = ({ task, result }) => {
      results.set(task.id, result);
    };

    this.scheduler.on('task.completed', recordResult);

    try {
      return await this.scheduler.run(taskGraph, runContext);
    } finally {
      this.scheduler.off('task.completed', recordResult);
    }
  }
}

// Create the default agent workflow.
export function createAgentWorkflow(options) {
  return new AgentWorkflow(options);
}

