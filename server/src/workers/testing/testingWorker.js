import { createTaskWorker } from '../../core/taskWorker.js';

export function createTestingWorker({ run = runTestingTask } = {}) {
  return createTaskWorker('testing', run);
}

async function runTestingTask(task, context) {
  const completed = [...(context.results?.values?.() ?? [])];
  const implementationCount = completed.filter((result) => (
    ['frontend', 'backend', 'database'].includes(result?.agent)
  )).length;

  return {
    agent: task.agent,
    taskId: task.id,
    summary: `Tested ${implementationCount} implementation result${implementationCount === 1 ? '' : 's'}.`,
  };
}
