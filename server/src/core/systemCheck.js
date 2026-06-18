// Import execFile for safe command execution.
import { execFile } from 'node:child_process';
// Import OS helpers for system diagnostics.
import { cpus, freemem, platform, release, totalmem } from 'node:os';
// Import promisify to convert execFile into a promise API.
import { promisify } from 'node:util';

// Create a promise-based execFile helper.
const execFileAsync = promisify(execFile);

// Build a complete local system readiness report.
export async function getSystemReport() {
  // Check whether the Ollama CLI is available.
  const ollama = await checkOllamaCli();
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
    // Include Ollama CLI detection.
    ollama,
    // Include a model recommendation based on memory.
    recommendation: getModelRecommendation(memory.totalGb),
  };
}

// Recommend an Ollama model and settings based on system memory.
export function getModelRecommendation(totalMemoryGb) {
  // Recommend a large model for very high memory systems.
  if (totalMemoryGb >= 48) {
    // Return the large profile.
    return {
      // Name the profile size.
      size: 'large',
      // Select the large model.
      model: 'gemma4:31b',
      // Use a larger context window.
      context: 8192,
      // Use a moderate temperature.
      temperature: 0.6,
    };
  }

  // Recommend a medium model for high memory systems.
  if (totalMemoryGb >= 24) {
    // Return the medium profile.
    return {
      // Name the profile size.
      size: 'medium',
      // Select the medium model.
      model: 'gemma4:e4b',
      // Use a medium context window.
      context: 6144,
      // Use a moderate temperature.
      temperature: 0.6,
    };
  }

  // Recommend a small model for typical local systems.
  if (totalMemoryGb >= 12) {
    // Return the small profile.
    return {
      // Name the profile size.
      size: 'small',
      // Select the small model.
      model: 'gemma4:e2b',
      // Use a balanced context window.
      context: 4096,
      // Use a slightly warmer temperature.
      temperature: 0.7,
    };
  }

  // Return a compact profile for low memory systems.
  return {
    // Name the profile size.
    size: 'compact',
    // Select the compact model.
    model: 'gemma3:1b',
    // Use a smaller context window.
    context: 2048,
    // Use a slightly warmer temperature.
    temperature: 0.7,
  };
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
    // Show Ollama CLI availability.
    `Ollama CLI: ${report.ollama.available ? report.ollama.version : 'not found'}`,
    // Show recommended model.
    `Recommended model: ${report.recommendation.model}`,
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
  // Treat any command failure as Ollama missing.
  } catch {
    // Return a missing Ollama result.
    return {
      // Mark Ollama as unavailable.
      available: false,
      // No version is available.
      version: null,
    };
  }
}

// Convert bytes into a one-decimal gigabyte value.
function toGb(bytes) {
  // Divide by 1024^3 and round to one decimal.
  return Number((bytes / 1024 / 1024 / 1024).toFixed(1));
}
