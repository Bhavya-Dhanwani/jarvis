// Import worker pool.
import { WorkerPool } from '../scheduler/workerPool.js';
// Import backend worker.
import { createBackendWorker } from './backend/backendWorker.js';
// Import database worker.
import { createDatabaseWorker } from './database/databaseWorker.js';
// Import frontend worker.
import { createFrontendWorker } from './frontend/frontendWorker.js';
// Import review worker.
import { createReviewWorker } from './review/reviewWorker.js';

// Create the default worker pool.
export function createDefaultWorkerPool(overrides = {}) {
  const workers = [
    overrides.frontend ?? createFrontendWorker(),
    overrides.backend ?? createBackendWorker(),
    overrides.database ?? createDatabaseWorker(),
    overrides.review ?? createReviewWorker(),
  ];

  return new WorkerPool(workers);
}
