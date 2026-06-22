// Import worker helper.
import { createTaskWorker } from '../../core/taskWorker.js';

// Create the frontend worker.
export function createFrontendWorker({ run = runFrontendTask } = {}) {
  return createTaskWorker('frontend', run);
}

// Run a frontend task.
async function runFrontendTask(task) {
  return {
    agent: task.agent,
    taskId: task.id,
    summary: `Prepared frontend work for: ${task.title}`,
  };
}
