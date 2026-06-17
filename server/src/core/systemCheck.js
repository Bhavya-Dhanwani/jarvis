import { execFile } from 'node:child_process';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function getSystemReport() {
  const ollama = await checkOllamaCli();
  const memory = {
    totalGb: toGb(totalmem()),
    freeGb: toGb(freemem()),
  };

  return {
    os: {
      platform: platform(),
      release: release(),
    },
    node: {
      version: process.version,
    },
    cpu: {
      model: cpus()[0]?.model ?? 'Unknown CPU',
      cores: cpus().length,
    },
    memory,
    ollama,
    recommendation: getModelRecommendation(memory.totalGb),
  };
}

export function getModelRecommendation(totalMemoryGb) {
  if (totalMemoryGb >= 48) {
    return {
      size: 'large',
      model: 'gemma4:31b',
      context: 8192,
      temperature: 0.6,
    };
  }

  if (totalMemoryGb >= 24) {
    return {
      size: 'medium',
      model: 'gemma4:e4b',
      context: 6144,
      temperature: 0.6,
    };
  }

  if (totalMemoryGb >= 12) {
    return {
      size: 'small',
      model: 'gemma4:e2b',
      context: 4096,
      temperature: 0.7,
    };
  }

  return {
    size: 'compact',
    model: 'gemma3:1b',
    context: 2048,
    temperature: 0.7,
  };
}

export function formatSystemReport(report) {
  return [
    'Jarvis system check',
    `OS: ${report.os.platform} ${report.os.release}`,
    `Node: ${report.node.version}`,
    `CPU: ${report.cpu.model} (${report.cpu.cores} cores)`,
    `Memory: ${report.memory.freeGb} GB free / ${report.memory.totalGb} GB total`,
    `Ollama CLI: ${report.ollama.available ? report.ollama.version : 'not found'}`,
    `Recommended model: ${report.recommendation.model}`,
    `Recommended context: ${report.recommendation.context}`,
  ].join('\n');
}

async function checkOllamaCli() {
  try {
    const { stdout } = await execFileAsync('ollama', ['--version'], {
      windowsHide: true,
    });

    return {
      available: true,
      version: stdout.trim(),
    };
  } catch {
    return {
      available: false,
      version: null,
    };
  }
}

function toGb(bytes) {
  return Number((bytes / 1024 / 1024 / 1024).toFixed(1));
}
