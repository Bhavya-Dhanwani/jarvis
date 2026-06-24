import { createTaskWorker } from '../../core/taskWorker.js';

export function createPlannerWorker({ run = runPlannerTask } = {}) {
  return createTaskWorker('planner', run);
}

async function runPlannerTask(task) {
  return {
    agent: task.agent,
    taskId: task.id,
    summary: `Planned workflow for: ${task.title}`,
  };
}
