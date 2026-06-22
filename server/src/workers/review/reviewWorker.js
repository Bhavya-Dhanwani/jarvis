// Import worker helper.
import { createTaskWorker } from '../../core/taskWorker.js';

// Create the review worker.
export function createReviewWorker({ run = runReviewTask } = {}) {
  return createTaskWorker('review', run);
}

// Run a review task over completed scheduler results.
async function runReviewTask(task, context) {
  const completed = [...(context.results?.values?.() ?? [])];

  return {
    agent: task.agent,
    taskId: task.id,
    summary: `Reviewed ${completed.length} completed task result${completed.length === 1 ? '' : 's'}.`,
  };
}
