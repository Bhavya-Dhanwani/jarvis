// Import strict assertions for tests.
import assert from 'node:assert/strict';
// Import Node's built-in test runner.
import test from 'node:test';
// Import planner workflow.
import { createAgentWorkflow } from '../src/core/agentWorkflow.js';
// Import task graph builder.
import { createTaskGraph } from '../src/dag/taskGraph.js';
// Import scheduler.
import { TaskScheduler } from '../src/scheduler/taskScheduler.js';
// Import worker pool.
import { WorkerPool } from '../src/scheduler/workerPool.js';

// Verify task graph validation rejects missing dependencies.
test('task graph rejects missing dependencies', () => {
  assert.throws(() => createTaskGraph([
    {
      id: 'frontend-task',
      title: 'Build UI',
      agent: 'frontend',
      dependencies: ['backend-task'],
    },
  ]), /depends on missing task/);
});

// Verify task graph validation rejects cycles.
test('task graph rejects dependency cycles', () => {
  assert.throws(() => createTaskGraph([
    {
      id: 'first-task',
      title: 'First',
      agent: 'backend',
      dependencies: ['second-task'],
    },
    {
      id: 'second-task',
      title: 'Second',
      agent: 'database',
      dependencies: ['first-task'],
    },
  ]), /contains a cycle/);
});

// Verify scheduler runs independent tasks in the same batch.
test('scheduler runs dependency-ready tasks in parallel', async () => {
  const started = [];
  const releases = new Map();
  const workers = new WorkerPool([
    createWorker('frontend', async (task) => {
      started.push(task.id);
      await new Promise((resolve) => releases.set(task.id, resolve));
      return task.id;
    }),
    createWorker('backend', async (task) => {
      started.push(task.id);
      await new Promise((resolve) => releases.set(task.id, resolve));
      return task.id;
    }),
    createWorker('review', async (task) => task.id),
  ]);
  const scheduler = new TaskScheduler({ workerPool: workers, retryDelayMs: 0 });
  const graph = createTaskGraph([
    {
      id: 'frontend-task',
      title: 'Build UI',
      agent: 'frontend',
      dependencies: [],
    },
    {
      id: 'backend-task',
      title: 'Build API',
      agent: 'backend',
      dependencies: [],
    },
    {
      id: 'review-task',
      title: 'Review',
      agent: 'review',
      dependencies: ['frontend-task', 'backend-task'],
    },
  ]);

  const run = scheduler.run(graph);
  await wait();

  assert.deepEqual(new Set(started), new Set(['frontend-task', 'backend-task']));
  assert.equal(started.includes('review-task'), false);

  releases.get('frontend-task')();
  releases.get('backend-task')();

  const result = await run;

  assert.equal(result.status, 'completed');
  assert.equal(result.results.get('review-task'), 'review-task');
});

// Verify scheduler retries transient worker failures and emits status events.
test('scheduler retries transient worker failures and emits events', async () => {
  let attempts = 0;
  const events = [];
  const workers = new WorkerPool([
    createWorker('backend', async () => {
      attempts += 1;

      if (attempts === 1) {
        const error = new Error('temporary failure');
        error.transient = true;
        throw error;
      }

      return 'ok';
    }),
  ]);
  const scheduler = new TaskScheduler({ workerPool: workers, maxRetries: 1, retryDelayMs: 0 });

  scheduler.on('task.started', ({ task }) => events.push(`started:${task.id}`));
  scheduler.on('task.failed', ({ task, retry }) => events.push(`failed:${task.id}:${retry}`));
  scheduler.on('task.completed', ({ task }) => events.push(`completed:${task.id}`));

  const result = await scheduler.run(createTaskGraph([
    {
      id: 'backend-task',
      title: 'Build API',
      agent: 'backend',
      dependencies: [],
    },
  ]));

  assert.equal(result.status, 'completed');
  assert.equal(attempts, 2);
  assert.deepEqual(events, [
    'started:backend-task',
    'failed:backend-task:true',
    'completed:backend-task',
  ]);
});

// Verify the default workflow completes request planning through review.
test('agent workflow plans, schedules, executes workers, and reviews', async () => {
  const workflow = createAgentWorkflow();
  const result = await workflow.run('build a frontend page with a backend api and database schema');

  assert.equal(result.status, 'completed');
  assert.equal(result.tasks.length, 7);
  assert.equal(result.results.has('planning-task'), true);
  assert.equal(result.results.has('prd-task'), true);
  assert.equal(result.results.has('frontend-task'), true);
  assert.equal(result.results.has('backend-task'), true);
  assert.equal(result.results.has('database-task'), true);
  assert.equal(result.results.has('testing-task'), true);
  const tasks = new Map(result.tasks.map((task) => [task.id, task]));
  assert.deepEqual(tasks.get('prd-task').dependencies, ['planning-task']);
  assert.deepEqual(tasks.get('frontend-task').dependencies, ['prd-task']);
  assert.deepEqual(tasks.get('backend-task').dependencies, ['prd-task']);
  assert.deepEqual(tasks.get('database-task').dependencies, ['prd-task']);
  assert.deepEqual(tasks.get('testing-task').dependencies.sort(), ['backend-task', 'database-task', 'frontend-task']);
  assert.deepEqual(tasks.get('review-task').dependencies, ['testing-task']);
  assert.equal(result.results.get('review-task').agent, 'review');
});

// Create a worker for tests.
function createWorker(agent, run) {
  return {
    agent,
    run,
  };
}

// Let scheduled promises start.
function wait() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

