// Import recommendation logic from system checks.
import { getModelRecommendation } from '../core/systemCheck.js';
// Import totalmem to choose defaults from local memory.
import { totalmem } from 'node:os';

// Create the Ollama model configuration for runtime chat.
export function createModelConfig({ totalMemoryGb } = {}) {
  // Choose a recommendation from provided or detected memory.
  const recommendation = getModelRecommendation(totalMemoryGb ?? getMemoryFromProcess());

  // Return host, model, and generation options.
  return {
    // Use env override or default local Ollama host.
    host: process.env.JARVIS_OLLAMA_HOST ?? 'http://127.0.0.1:11434',
    // Use env override or recommended model.
    model: process.env.JARVIS_OLLAMA_MODEL ?? recommendation.model,
    // Store Ollama generation options.
    options: {
      // Use env override or recommended context size.
      num_ctx: Number(process.env.JARVIS_OLLAMA_CONTEXT ?? recommendation.context),
      // Use env override or recommended temperature.
      temperature: Number(process.env.JARVIS_OLLAMA_TEMPERATURE ?? recommendation.temperature),
    },
  };
}

// Read system memory from Node.
function getMemoryFromProcess() {
  // Convert total memory bytes into a whole number of GB.
  return Math.max(1, Math.round(totalmem() / 1024 / 1024 / 1024));
}
