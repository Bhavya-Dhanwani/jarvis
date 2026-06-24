// Import worker pool.
import { WorkerPool } from '../scheduler/workerPool.js';
// Import backend worker.
import { createBackendWorker } from './backend/backendWorker.js';
// Import database worker.
import { createDatabaseWorker } from './database/databaseWorker.js';
// Import frontend worker.
import { createFrontendWorker } from './frontend/frontendWorker.js';
import { createPlannerWorker } from './planner/plannerWorker.js';
import { createPrdWorker } from './prd/prdWorker.js';
// Import review worker.
import { createReviewWorker } from './review/reviewWorker.js';
import { createTestingWorker } from './testing/testingWorker.js';

// Create the default worker pool.
export function createDefaultWorkerPool(overrides = {}) {
  const workers = [
    overrides.planner ?? createPlannerWorker(),
    overrides.prd ?? createPrdWorker(),
    overrides.frontend ?? createFrontendWorker(),
    overrides.backend ?? createBackendWorker(),
    overrides.database ?? createDatabaseWorker(),
    overrides.testing ?? createTestingWorker(),
    overrides.review ?? createReviewWorker(),
  ];

  return new WorkerPool(workers);
}


