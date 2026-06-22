// Import worker helper.
import { createTaskWorker } from '../../core/taskWorker.js';

// Create the database worker.
export function createDatabaseWorker({ run = runDatabaseTask } = {}) {
  return createTaskWorker('database', run);
}

// Run a database task.
async function runDatabaseTask(task) {
  return {
    agent: task.agent,
    taskId: task.id,
    summary: `Prepared database work for: ${task.title}`,
  };
}
