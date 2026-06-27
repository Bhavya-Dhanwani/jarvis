// Import recommendation logic from system checks.
import { getModelRecommendation } from '../core/systemCheck.js';
// Import filesystem helpers to load saved setup config.
import { existsSync, readFileSync, statSync } from 'node:fs';
// Import totalmem to choose defaults from local memory.
import { homedir, platform, totalmem } from 'node:os';
// Import path helpers for saved config discovery.
import { join } from 'node:path';

// Create the Ollama model configuration for runtime chat.
export function createModelConfig({ totalMemoryGb, env = process.env } = {}) {
  // Choose a recommendation from provided or detected memory.
  const recommendation = getModelRecommendation(totalMemoryGb ?? getMemoryFromProcess());
  // Streaming/continuation tuning travels with the recommendation tier.
  const tuning = recommendation.tuning;
  // Load the model saved by the setup wizard when available.
  const savedConfig = loadSavedModelConfig({ env });

  // Return host, model, and generation options.
  return {
    // Use env override, saved host, or default local Ollama host.
    host: env.JARVIS_OLLAMA_HOST ?? savedConfig?.host ?? 'http://127.0.0.1:11434',
    // Prefer the setup-selected model, then env override, then recommendation.
    model: savedConfig?.model ?? env.JARVIS_OLLAMA_MODEL ?? recommendation.model,
    // Store Ollama generation options.
    options: {
      // Use env override or recommended context size.
      num_ctx: Number(env.JARVIS_OLLAMA_CONTEXT ?? recommendation.context),
      // Use env override or recommended temperature.
      temperature: Number(env.JARVIS_OLLAMA_TEMPERATURE ?? recommendation.temperature),
      // Match prompt ingestion batch size to the detected system profile.
      num_batch: Number(env.JARVIS_OLLAMA_NUM_BATCH ?? tuning.numBatch),
      // Keep normal CLI replies short enough to stay responsive.
      num_predict: Number(env.JARVIS_OLLAMA_NUM_PREDICT ?? 64),
      // Match code chunk size to the detected system profile.
      code_num_predict: Number(env.JARVIS_OLLAMA_CODE_CHUNK_TOKENS ?? tuning.codeChunkTokens),
      // Use the profile context for code unless explicitly overridden.
      code_num_ctx: Number(env.JARVIS_OLLAMA_CODE_CONTEXT ?? recommendation.context),
    },
    // Keep the model loaded according to the detected system profile.
    keepAlive: env.JARVIS_OLLAMA_KEEP_ALIVE ?? tuning.keepAlive,
    // Keep the warmed model resident for the same window as real prompts, so the
    // first message after start-up is fast instead of paying a fresh cold load.
    warmKeepAlive: env.JARVIS_OLLAMA_WARM_KEEP_ALIVE ?? tuning.keepAlive,
    // Allow long answers to keep streaming through several bounded requests.
    maxAutoContinuations: Number(env.JARVIS_OLLAMA_MAX_CONTINUATIONS ?? tuning.maxAutoContinuations),
    // Use gentle background warm-up by default; set JARVIS_OLLAMA_WARMUP=false to disable.
    warmOnStart: !isDisabled(env.JARVIS_OLLAMA_WARMUP),
    // Stream the model's reasoning ("Thinking...") by default; auto-disables if the
    // model has no thinking mode. Set JARVIS_OLLAMA_THINK=false to turn it off.
    think: !isDisabled(env.JARVIS_OLLAMA_THINK),
    // Expose where the active model came from for diagnostics.
    source: savedConfig?.source ?? (env.JARVIS_OLLAMA_MODEL ? 'env' : 'recommendation'),
  };
}

// Parse common falsey environment values.
function isDisabled(value) {
  return /^(0|false|no|off)$/i.test(String(value ?? '').trim());
}

// Load the setup-selected model from disk.
export function loadSavedModelConfig({ env = process.env } = {}) {
  const candidates = getConfigCandidates({ env })
    .map(readConfigCandidate)
    .filter(Boolean)
    .sort((left, right) => left.priority - right.priority || right.mtimeMs - left.mtimeMs);

  return candidates[0]?.config ?? null;
}

// Build the list of places setup may have saved config.
function getConfigCandidates({ env }) {
  const candidates = [];

  if (env.JARVIS_CONFIG_PATH) {
    return [{ path: env.JARVIS_CONFIG_PATH, priority: 0 }];
  }

  if (env.JARVIS_DATA_ROOT) {
    return [{ path: join(env.JARVIS_DATA_ROOT, 'config.json'), priority: 1 }];
  }

  candidates.push({ path: join(homedir(), '.jarvis', 'config.json'), priority: 2 });

  if (platform() === 'win32') {
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      candidates.push({ path: `${letter}:\\Jarvis\\data\\config.json`, priority: 2 });
    }
  }

  return [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()];
}

// Read one config file candidate, ignoring missing or malformed files.
function readConfigCandidate(candidate) {
  try {
    const configPath = candidate.path;

    if (!existsSync(configPath)) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));

    if (!parsed?.model || typeof parsed.model !== 'string') {
      return null;
    }

    return {
      mtimeMs: statSync(configPath).mtimeMs,
      priority: candidate.priority,
      config: {
        model: parsed.model,
        host: typeof parsed.host === 'string' ? parsed.host : undefined,
        path: configPath,
        source: 'saved-config',
      },
    };
  } catch {
    return null;
  }
}

// Read system memory from Node.
function getMemoryFromProcess() {
  // Convert total memory bytes into a whole number of GB.
  return Math.max(1, Math.round(totalmem() / 1024 / 1024 / 1024));
}
