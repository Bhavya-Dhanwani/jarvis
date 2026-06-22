// Route tasks to workers by agent type.
export class WorkerPool {
  // Store workers in a registry keyed by agent type.
  constructor(workers = []) {
    // Store workers by agent type.
    this.workers = new Map();

    workers.forEach((worker) => this.register(worker));
  }

  // Register a worker implementation.
  register(worker) {
    if (!worker?.agent) {
      throw new Error('Worker agent is required.');
    }

    if (typeof worker.run !== 'function') {
      throw new Error(`Worker ${worker.agent} must implement run().`);
    }

    this.workers.set(worker.agent, worker);
  }

  // Return whether an agent has a worker.
  has(agent) {
    return this.workers.has(agent);
  }

  // Run a task with the worker for its agent.
  async run(task, context) {
    const worker = this.workers.get(task.agent);

    if (!worker) {
      throw new Error(`No worker registered for agent: ${task.agent}`);
    }

    return worker.run(task, context);
  }
}
