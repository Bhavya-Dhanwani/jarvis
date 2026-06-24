// Import task graph builder.
import { createTaskGraph } from '../../dag/taskGraph.js';

// Define default agent planning rules.
const DEFAULT_AGENT_RULES = [
  {
    agent: 'database',
    patterns: [/\bdatabase\b/i, /\bschema\b/i, /\bsql\b/i, /\bpersist/i],
    title: 'Plan data changes',
  },
  {
    agent: 'backend',
    patterns: [/\bapi\b/i, /\bserver\b/i, /\bbackend\b/i, /\bservice\b/i],
    title: 'Plan backend changes',
  },
  {
    agent: 'frontend',
    patterns: [
      /\bui\b/i,
      /\bfrontend\b/i,
      /\bpage\b/i,
      /\bcomponent\b/i,
      /\bhtml\b/i,
      /\bcss\b/i,
      /\b(?:java|type)script\b/i,
      /\bjs\b/i,
      /\bchat interface\b/i,
      /\bwebsite\b/i,
    ],
    title: 'Plan frontend changes',
  },
];

// Plan a user request into a task graph.
export class PlannerAgent {
  // Store planner rules.
  constructor({ rules = DEFAULT_AGENT_RULES } = {}) {
    // Store rules by agent for future extension.
    this.rules = new Map(rules.map((rule) => [rule.agent, rule]));
  }

  // Create a task graph for a request.
  plan(request) {
    const selectedRules = this.#selectRules(request);
    const planningTask = {
      id: 'planning-task',
      title: 'Plan implementation workflow',
      agent: 'planner',
      dependencies: [],
      input: { request },
    };
    const prdTask = {
      id: 'prd-task',
      title: 'Define implementation requirements',
      agent: 'prd',
      dependencies: [planningTask.id],
      input: { request },
    };
    const implementationTasks = selectedRules.map((rule) => ({
      id: `${rule.agent}-task`,
      title: rule.title,
      agent: rule.agent,
      dependencies: [prdTask.id],
      input: {
        request,
      },
    }));

    const testingTask = {
      id: 'testing-task',
      title: 'Test completed implementation',
      agent: 'testing',
      dependencies: implementationTasks.map((task) => task.id),
      input: {
        request,
      },
    };
    const reviewTask = {
      id: 'review-task',
      title: 'Review completed work',
      agent: 'review',
      dependencies: [testingTask.id],
      input: {
        request,
      },
    };

    return createTaskGraph([planningTask, prdTask, ...implementationTasks, testingTask, reviewTask]);
  }

  // Select matching agent rules for a request.
  #selectRules(request) {
    const text = String(request ?? '');
    const matches = [...this.rules.values()].filter((rule) => (
      rule.patterns.some((pattern) => pattern.test(text))
    ));

    if (matches.length > 0) {
      return matches;
    }

    return [this.rules.get('backend')];
  }
}

// Create the default planner agent.
export function createPlannerAgent(options) {
  return new PlannerAgent(options);
}

