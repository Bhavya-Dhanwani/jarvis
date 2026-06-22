// Import worker helper.
import { createTaskWorker } from '../../core/taskWorker.js';

// Create the backend worker.
export function createBackendWorker({ run = runBackendTask } = {}) {
  return createTaskWorker('backend', run);
}

// Run a backend task.
async function runBackendTask(task) {
  return {
    agent: task.agent,
    taskId: task.id,
    summary: `Prepared backend work for: ${task.title}`,
  };
}
