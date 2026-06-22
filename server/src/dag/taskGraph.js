// Define task statuses used by the scheduler.
export const TASK_STATUS = Object.freeze({
  pending: 'pending',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
});

// Store tasks and dependencies as a directed acyclic graph.
export class TaskGraph {
  // Store tasks by ID for fast lookup.
  constructor(tasks = []) {
    // Store task records.
    this.tasks = new Map();
    // Store task dependencies.
    this.dependencyMap = new Map();
    // Store reverse dependencies for ready-task lookups.
    this.dependentMap = new Map();

    tasks.forEach((task) => this.addTask(task));
    this.validate();
  }

  // Add a task to the graph.
  addTask(task) {
    if (!task?.id) {
      throw new Error('Task id is required.');
    }

    if (!task.title) {
      throw new Error(`Task ${task.id} title is required.`);
    }

    if (!task.agent) {
      throw new Error(`Task ${task.id} agent is required.`);
    }

    if (this.tasks.has(task.id)) {
      throw new Error(`Duplicate task id: ${task.id}`);
    }

    const dependencies = new Set(task.dependencies ?? []);
    const storedTask = {
      ...task,
      status: task.status ?? TASK_STATUS.pending,
      dependencies: [...dependencies],
    };

    this.tasks.set(task.id, storedTask);
    this.dependencyMap.set(task.id, dependencies);
    this.dependentMap.set(task.id, new Set());

    dependencies.forEach((dependencyId) => {
      if (!this.dependentMap.has(dependencyId)) {
        this.dependentMap.set(dependencyId, new Set());
      }

      this.dependentMap.get(dependencyId).add(task.id);
    });
  }

  // Validate graph references and cycles.
  validate() {
    for (const [taskId, dependencies] of this.dependencyMap) {
      for (const dependencyId of dependencies) {
        if (!this.tasks.has(dependencyId)) {
          throw new Error(`Task ${taskId} depends on missing task ${dependencyId}.`);
        }
      }
    }

    const visiting = new Set();
    const visited = new Set();

    for (const taskId of this.tasks.keys()) {
      this.#visit(taskId, visiting, visited);
    }
  }

  // Return pending tasks whose dependencies are complete.
  getReadyTasks(completedTasks) {
    const readyTasks = [];

    for (const task of this.tasks.values()) {
      if (task.status !== TASK_STATUS.pending) {
        continue;
      }

      const dependencies = this.dependencyMap.get(task.id) ?? new Set();
      const ready = [...dependencies].every((dependencyId) => completedTasks.has(dependencyId));

      if (ready) {
        readyTasks.push(task);
      }
    }

    return readyTasks;
  }

  // Update task status.
  setStatus(taskId, status) {
    const task = this.tasks.get(taskId);

    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }

    task.status = status;
    return task;
  }

  // Return all tasks in insertion order.
  listTasks() {
    return [...this.tasks.values()];
  }

  // Return true when all tasks reached a terminal status.
  isComplete() {
    return this.listTasks().every((task) => (
      task.status === TASK_STATUS.completed || task.status === TASK_STATUS.failed
    ));
  }

  // Walk task dependencies and detect cycles.
  #visit(taskId, visiting, visited) {
    if (visited.has(taskId)) {
      return;
    }

    if (visiting.has(taskId)) {
      throw new Error(`Task graph contains a cycle at ${taskId}.`);
    }

    visiting.add(taskId);

    for (const dependencyId of this.dependencyMap.get(taskId) ?? []) {
      this.#visit(dependencyId, visiting, visited);
    }

    visiting.delete(taskId);
    visited.add(taskId);
  }
}

// Create a task graph from plain task definitions.
export function createTaskGraph(tasks) {
  return new TaskGraph(tasks);
}
