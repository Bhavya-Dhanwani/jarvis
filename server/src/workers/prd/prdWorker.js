import { createTaskWorker } from '../../core/taskWorker.js';

export function createPrdWorker({ run = runPrdTask } = {}) {
  return createTaskWorker('prd', run);
}

async function runPrdTask(task) {
  return {
    agent: task.agent,
    taskId: task.id,
    summary: `Prepared requirements for: ${task.title}`,
  };
}
