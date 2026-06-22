// Base worker for agent-specific task handlers.
export class TaskWorker {
  // Store agent type and handler.
  constructor({ agent, run }) {
    // Store the agent type used by the worker pool.
    this.agent = agent;
    // Store the task handler.
    this.handler = run;
  }

  // Run a task through the configured handler.
  async run(task, context) {
    return this.handler(task, context);
  }
}

// Create a simple worker for a specific agent type.
export function createTaskWorker(agent, run) {
  return new TaskWorker({ agent, run });
}
