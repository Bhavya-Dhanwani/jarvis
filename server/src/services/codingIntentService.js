// Reuse the small-talk detector so casual greetings skip the routing model call too.
import { isSmallTalk } from './ollamaService.js';

// Decide whether a chat message should enter the coding workflow.
export class CodingIntentService {
  // Store the existing assistant service.
  constructor({ assistantService }) {
    // Reuse the configured model instead of creating another provider.
    this.assistantService = assistantService;
  }

  // Classify one user message as chat or code.
  async classify(message, { cwd = process.cwd() } = {}) {
    if (!this.assistantService || isSimpleConversation(message)) {
      return {
        intent: 'chat',
        reason: 'Simple conversation does not require workspace work.',
      };
    }

    // Routing runs before every answer. A prompt with no workspace-action verb is
    // almost always plain chat, so decide that locally and let the answer start
    // streaming immediately instead of waiting on a full classification round trip.
    if (!hasWorkspaceActionSignal(message)) {
      return {
        intent: 'chat',
        reason: 'No workspace action detected; answering directly.',
      };
    }

    try {
      const reply = await this.assistantService.generateReply([
        {
          role: 'system',
          content: 'Classify the user request for Jarvis. Choose "code" only when the user asks to inspect, create, modify, debug, test, or implement files in the current workspace. Choose "chat" for explanations, questions, brainstorming, and ordinary conversation that do not request workspace changes. Return only JSON: {"intent":"code"|"chat","reason":"short reason"}. Never choose command execution or Git push.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            message,
            workspace: cwd,
          }),
        },
      ], {
        // Routing runs before every answer, so it must be fast: never reason, emit only
        // the tiny JSON verdict, and never auto-continue. Otherwise it doubles latency.
        think: false,
        maxContinuations: 0,
        generationOptions: { num_predict: 64 },
      });

      return parseIntent(reply);
    } catch {
      return {
        intent: 'chat',
        reason: 'Intent classification was unavailable.',
      };
    }
  }
}

// Create the coding intent service.
export function createCodingIntentService(options) {
  return new CodingIntentService(options);
}

// Parse the model response without trusting surrounding prose.
function parseIntent(reply) {
  const text = String(reply ?? '').trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];

  if (!json) {
    return {
      intent: 'chat',
      reason: 'Intent response was not valid JSON.',
    };
  }

  try {
    const parsed = JSON.parse(json);

    if (parsed.intent !== 'code') {
      return {
        intent: 'chat',
        reason: String(parsed.reason ?? 'The request does not require workspace changes.'),
      };
    }

    return {
      intent: 'code',
      reason: String(parsed.reason ?? 'The request requires workspace changes.'),
    };
  } catch {
    return {
      intent: 'chat',
      reason: 'Intent response was not valid JSON.',
    };
  }
}

// Keep tiny social turns on the existing local fast path (greetings, thanks, "how are you").
function isSimpleConversation(message) {
  return isSmallTalk(message);
}

// Verbs that imply acting on the workspace. Coding requests almost always contain one
// ("fix the route", "add a test", "refactor app.js"); pure questions/explanations
// ("what is recursion", "explain closures in javascript") do not. Only prompts with a
// signal pay the model classification cost — everything else routes to chat instantly.
const WORKSPACE_ACTION_SIGNAL = /\b(create|add|implement|build|scaffold|generate|write|code|fix|debug|patch|repair|resolve|refactor|rename|move|delete|remove|drop|update|change|edit|modify|replace|insert|append|migrate|install|configure|setup|wire|integrate|test|run|execute|deploy|commit|push|lint|format|optimize|review)\b/i;

// True when the message looks like it asks Jarvis to do something to the workspace.
function hasWorkspaceActionSignal(message) {
  return WORKSPACE_ACTION_SIGNAL.test(String(message ?? ''));
}
