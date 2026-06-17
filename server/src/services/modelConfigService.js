import { getModelRecommendation } from '../core/systemCheck.js';
import { totalmem } from 'node:os';

export function createModelConfig({ totalMemoryGb } = {}) {
  const recommendation = getModelRecommendation(totalMemoryGb ?? getMemoryFromProcess());

  return {
    host: process.env.JARVIS_OLLAMA_HOST ?? 'http://127.0.0.1:11434',
    model: process.env.JARVIS_OLLAMA_MODEL ?? recommendation.model,
    options: {
      num_ctx: Number(process.env.JARVIS_OLLAMA_CONTEXT ?? recommendation.context),
      temperature: Number(process.env.JARVIS_OLLAMA_TEMPERATURE ?? recommendation.temperature),
    },
  };
}

function getMemoryFromProcess() {
  return Math.max(1, Math.round(totalmem() / 1024 / 1024 / 1024));
}
