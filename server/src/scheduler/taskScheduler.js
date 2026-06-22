// Import event emitter for scheduler status events.
import { EventEmitter } from 'node:events';
// Import task statuses.
import { TASK_STATUS } from '../dag/taskGraph.js';

// Execute a task graph with dependency-aware parallel batches.
export class TaskScheduler extends EventEmitter {
  // Store worker pool and retry configuration.
  constructor({ workerPool, maxRetries = 2, retryDelayMs = 10 } = {}) {
    super();
    // Store the worker pool.
    this.workerPool = workerPool;
    // Store retry count for transient failures.
    this.maxRetries = maxRetries;
    // Store retry delay.
    this.retryDelayMs = retryDelayMs;
  }

  // Run every task in the graph.
  async run(taskGraph, context = {}) {
    // Track completed tasks for dependency checks.
    const completedTasks = new Set();
    // Track task results by task ID.
    const results = new Map();
    // Track failed tasks by task ID.
    const failedTasks = new Map();

    while (!taskGraph.isComplete()) {
      const readyTasks = taskGraph.getReadyTasks(completedTasks);

      if (readyTasks.length === 0) {
        throw new Error('Task scheduler stopped because no runnable tasks remain.');
      }

      await Promise.all(readyTasks.map((task) => (
        this.#runTask(taskGraph, task, context)
          .then((result) => {
            completedTasks.add(task.id);
            results.set(task.id, result);
          })
          .catch((error) => {
            failedTasks.set(task.id, error);
          })
      )));

      if (failedTasks.size > 0) {
        break;
      }
    }

    return {
      status: failedTasks.size > 0 ? 'failed' : 'completed',
      tasks: taskGraph.listTasks(),
      results,
      failedTasks,
    };
  }

  // Run one task with retries for transient errors.
  async #runTask(taskGraph, task, context) {
    taskGraph.setStatus(task.id, TASK_STATUS.running);
    this.emit('task.started', { task });

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await this.workerPool.run(task, context);

        taskGraph.setStatus(task.id, TASK_STATUS.completed);
        this.emit('task.completed', { task, result });
        return result;
      } catch (error) {
        const retry = attempt < this.maxRetries && isTransientError(error);

        this.emit('task.failed', { task, error, attempt, retry });

        if (!retry) {
          taskGraph.setStatus(task.id, TASK_STATUS.failed);
          throw error;
        }

        await wait(this.retryDelayMs);
      }
    }

    throw new Error(`Task ${task.id} failed without a captured error.`);
  }
}

// Treat explicit transient errors and common temporary codes as retryable.
export function isTransientError(error) {
  if (error?.transient === true) {
    return true;
  }

  return new Set(['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'EBUSY']).has(error?.code);
}

// Wait before retrying a task.
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
