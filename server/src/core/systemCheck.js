// Import execFile for safe command execution.
import { execFile } from 'node:child_process';
// Import OS helpers for system diagnostics.
import { cpus, freemem, platform, release, totalmem } from 'node:os';
// Import promisify to convert execFile into a promise API.
import { promisify } from 'node:util';
// Import Windows Ollama helpers for installs that are present but missing from PATH.
import { ensureWindowsPathContains, findWindowsOllamaExecutable } from '../setup/windowsSetup.js';
// Import dirname so the found executable folder can be added to PATH.
import { dirname } from 'node:path';

// Create a promise-based execFile helper.
const execFileAsync = promisify(execFile);

// Build a complete local system readiness report.
export async function getSystemReport() {
  // Check whether the Ollama CLI is available.
  const ollama = await checkOllamaCli();
  // Detect a GPU so the recommendation can step up a tier when present.
  const gpu = await detectGpu();
  // Capture total and free memory in gigabytes.
  const memory = {
    // Convert total memory from bytes to GB.
    totalGb: toGb(totalmem()),
    // Convert free memory from bytes to GB.
    freeGb: toGb(freemem()),
  };

  // Return structured system diagnostics.
  return {
    // Include OS platform and release.
    os: {
      // Store the Node platform value.
      platform: platform(),
      // Store the OS release value.
      release: release(),
    },
    // Include Node runtime info.
    node: {
      // Store the Node version.
      version: process.version,
    },
    // Include CPU info.
    cpu: {
      // Store the first CPU model or a fallback.
      model: cpus()[0]?.model ?? 'Unknown CPU',
      // Store the CPU core count.
      cores: cpus().length,
    },
    // Include memory information.
    memory,
    // Include GPU detection.
    gpu,
    // Include Ollama CLI detection.
    ollama,
    // Include a model recommendation based on memory and GPU.
    recommendation: getModelRecommendation(memory.totalGb, { gpu: gpu.available }),
  };
}

// Ordered RAM tiers, anchored on the finalized 8 GB profile (qwen3:4b). Each tier
// names three Qwen models (dense = most reliable for tool-calling/MCP + reasoning):
//   main   - best all-rounder that fits: code + tool-use + reasoning
//   coding - sharper pure-coding pick for /code
//   fast   - lighter model for max speed / light automation
// Tiers scale down to ~3 GB and up to TB-class servers. A detected GPU bumps the
// machine up one tier (it can run the next size comfortably).
export const MODEL_TIERS = [
  {
    size: 'micro', minGb: 0, context: 2048, temperature: 0.7,
    models: { main: 'qwen3:1.7b', coding: 'qwen2.5-coder:1.5b', fast: 'qwen3:0.6b' },
    tuning: { numBatch: 64, codeChunkTokens: 256, keepAlive: '10m', maxAutoContinuations: 8 },
  },
  {
    size: 'tiny', minGb: 4, context: 2048, temperature: 0.7,
    models: { main: 'qwen3:1.7b', coding: 'qwen2.5-coder:1.5b', fast: 'qwen3:0.6b' },
    tuning: { numBatch: 128, codeChunkTokens: 384, keepAlive: '10m', maxAutoContinuations: 10 },
  },
  {
    // 8 GB anchor (covers 6-11.9 GB).
    size: 'small', minGb: 6, context: 4096, temperature: 0.6,
    models: { main: 'qwen3:4b', coding: 'qwen2.5-coder:3b', fast: 'qwen3:1.7b' },
    tuning: { numBatch: 256, codeChunkTokens: 512, keepAlive: '30m', maxAutoContinuations: 12 },
  },
  {
    // 16 GB.
    size: 'medium', minGb: 12, context: 8192, temperature: 0.6,
    models: { main: 'qwen3:8b', coding: 'qwen2.5-coder:7b', fast: 'qwen3:4b' },
    tuning: { numBatch: 512, codeChunkTokens: 768, keepAlive: '30m', maxAutoContinuations: 14 },
  },
  {
    // 32 GB.
    size: 'large', minGb: 24, context: 16384, temperature: 0.6,
    models: { main: 'qwen3:14b', coding: 'qwen2.5-coder:14b', fast: 'qwen3:8b' },
    tuning: { numBatch: 512, codeChunkTokens: 1024, keepAlive: '30m', maxAutoContinuations: 16 },
  },
  {
    // 64 GB.
    size: 'xlarge', minGb: 48, context: 32768, temperature: 0.6,
    models: { main: 'qwen3:32b', coding: 'qwen2.5-coder:32b', fast: 'qwen3:14b' },
    tuning: { numBatch: 512, codeChunkTokens: 1024, keepAlive: '30m', maxAutoContinuations: 16 },
  },
  {
    // 128-256 GB workstation.
    size: 'workstation', minGb: 128, context: 65536, temperature: 0.6,
    models: { main: 'qwen3:32b', coding: 'qwen3-coder:30b', fast: 'qwen3:14b' },
    tuning: { numBatch: 512, codeChunkTokens: 1536, keepAlive: '30m', maxAutoContinuations: 16 },
  },
  {
    // 512 GB+ server.
    size: 'server', minGb: 512, context: 131072, temperature: 0.6,
    models: { main: 'qwen3-coder:30b', coding: 'qwen3-coder:30b', fast: 'qwen3:32b' },
    tuning: { numBatch: 512, codeChunkTokens: 2048, keepAlive: '30m', maxAutoContinuations: 16 },
  },
  {
    // 1 TB-4 TB datacenter: flagship models.
    size: 'datacenter', minGb: 1024, context: 131072, temperature: 0.6,
    models: { main: 'qwen3.5:122b', coding: 'qwen3-coder-next:80b', fast: 'qwen3:32b' },
    tuning: { numBatch: 512, codeChunkTokens: 2048, keepAlive: '30m', maxAutoContinuations: 16 },
  },
];

// Recommend an Ollama model profile from system memory (and an optional GPU boost).
export function getModelRecommendation(totalMemoryGb, { gpu = false } = {}) {
  const memory = Number.isFinite(totalMemoryGb) ? totalMemoryGb : 0;

  let index = 0;

  for (let i = 0; i < MODEL_TIERS.length; i += 1) {
    if (memory >= MODEL_TIERS[i].minGb) {
      index = i;
    }
  }

  // A capable GPU runs the next size up comfortably, so step up one tier.
  if (gpu && index < MODEL_TIERS.length - 1) {
    index += 1;
  }

  const tier = MODEL_TIERS[index];

  return {
    size: tier.size,
    // `model` stays the primary all-rounder for backward compatibility.
    model: tier.models.main,
    models: tier.models,
    context: tier.context,
    temperature: tier.temperature,
    tuning: tier.tuning,
    gpuBoosted: Boolean(gpu),
  };
}

// Best-effort detection of a GPU that meaningfully accelerates Ollama.
export async function detectGpu() {
  // NVIDIA on any OS.
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      windowsHide: true,
    });
    const name = stdout.split('\n').map((line) => line.trim()).find(Boolean);

    if (name) {
      return { available: true, name };
    }
  } catch {
    // No NVIDIA GPU / driver; keep checking.
  }

  // Apple Silicon: integrated GPU with unified memory is fast for local models.
  if (platform() === 'darwin' && process.arch === 'arm64') {
    return { available: true, name: 'Apple Silicon GPU' };
  }

  return { available: false, name: null };
}

// Format the system report as CLI text.
export function formatSystemReport(report) {
  // Build readable lines for the report.
  return [
    // Add report heading.
    'Jarvis system check',
    // Show OS details.
    `OS: ${report.os.platform} ${report.os.release}`,
    // Show Node version.
    `Node: ${report.node.version}`,
    // Show CPU model and core count.
    `CPU: ${report.cpu.model} (${report.cpu.cores} cores)`,
    // Show memory totals.
    `Memory: ${report.memory.freeGb} GB free / ${report.memory.totalGb} GB total`,
    // Show GPU detection.
    `GPU: ${report.gpu?.available ? report.gpu.name : 'none detected (CPU only)'}`,
    // Show Ollama CLI availability.
    `Ollama CLI: ${report.ollama.available ? report.ollama.version : 'not found'}`,
    // Show recommended model.
    `Recommended model: ${report.recommendation.model} (${report.recommendation.size} tier)`,
    // Show the per-role models for this machine.
    `Models — main: ${report.recommendation.models.main} · coding: ${report.recommendation.models.coding} · fast: ${report.recommendation.models.fast}`,
    // Show recommended context size.
    `Recommended context: ${report.recommendation.context}`,
  // Join lines with newlines for terminal output.
  ].join('\n');
}

// Check whether the Ollama CLI can run.
async function checkOllamaCli() {
  // Try to execute the version command.
  try {
    // Run ollama without invoking a shell.
    const { stdout } = await execFileAsync('ollama', ['--version'], {
      // Hide extra Windows console windows.
      windowsHide: true,
    });

    // Return successful detection.
    return {
      // Mark Ollama as available.
      available: true,
      // Store the trimmed version output.
      version: stdout.trim(),
    };
  // Try the Windows default install locations when PATH cannot resolve ollama.
  } catch (error) {
    return repairWindowsOllamaDetection(error);
  }
}

// Repair Windows installs where Ollama exists but the shell PATH is missing it.
async function repairWindowsOllamaDetection(originalError) {
  if (platform() !== 'win32') {
    return missingOllamaResult(originalError);
  }

  const installedPath = findWindowsOllamaExecutable();

  if (!installedPath) {
    return missingOllamaResult(originalError);
  }

  try {
    const pathUpdate = await ensureWindowsPathContains(dirname(installedPath));
    const { stdout } = await execFileAsync(installedPath, ['--version'], {
      windowsHide: true,
    });

    return {
      available: true,
      version: stdout.trim(),
      path: installedPath,
      pathUpdated: pathUpdate.userChanged || pathUpdate.currentChanged,
    };
  } catch (error) {
    return missingOllamaResult(error);
  }
}

// Return a consistent missing result with optional diagnostics.
function missingOllamaResult(error) {
  return {
    // Mark Ollama as unavailable.
    available: false,
    // No version is available.
    version: null,
    // Preserve the error for callers that want diagnostics.
    error,
  };
}

// Convert bytes into a one-decimal gigabyte value.
function toGb(bytes) {
  // Divide by 1024^3 and round to one decimal.
  return Number((bytes / 1024 / 1024 / 1024).toFixed(1));
}
