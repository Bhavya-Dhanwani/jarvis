import { createModelConfig } from './modelConfigService.js';
import { getSystemReport } from '../core/systemCheck.js';

export async function getSetupReport() {
  const system = await getSystemReport();
  const modelConfig = createModelConfig({ totalMemoryGb: system.memory.totalGb });
  const ollamaServer = await checkOllamaServer(modelConfig.host);
  const model = ollamaServer.available
    ? findModel(ollamaServer.models, modelConfig.model)
    : null;

  return {
    system,
    modelConfig,
    ollamaServer,
    model,
    ready: system.ollama.available && ollamaServer.available && model?.available === true,
  };
}

export function formatSetupReport(report) {
  const lines = [
    'Jarvis setup',
    '',
    `Ollama CLI: ${report.system.ollama.available ? 'found' : 'missing'}`,
    `Ollama server: ${report.ollamaServer.available ? 'running' : 'not reachable'}`,
    `Selected model: ${report.modelConfig.model}`,
    `Context: ${report.modelConfig.options.num_ctx}`,
    `Temperature: ${report.modelConfig.options.temperature}`,
    `Model installed: ${report.model?.available ? 'yes' : 'no'}`,
    '',
  ];

  if (report.ready) {
    lines.push('Jarvis is ready. Run:');
    lines.push('  jarvis');
    return lines.join('\n');
  }

  lines.push('Next steps:');

  if (!report.system.ollama.available) {
    lines.push('  1. Install Ollama from https://ollama.com/download');
    lines.push('  2. Close and reopen the terminal after installing.');
  } else if (!report.ollamaServer.available) {
    lines.push('  1. Start Ollama.');
    lines.push('     On Windows, open the Ollama app from the Start menu.');
    lines.push('     Or run: ollama serve');
  } else if (!report.model?.available) {
    lines.push(`  1. Pull the selected model: ollama pull ${report.modelConfig.model}`);
  }

  lines.push('');
  lines.push('Optional model override:');
  lines.push('  PowerShell: $env:JARVIS_OLLAMA_MODEL="gemma3:1b"');
  lines.push('  Bash: export JARVIS_OLLAMA_MODEL="gemma3:1b"');

  return lines.join('\n');
}

async function checkOllamaServer(host) {
  try {
    const response = await fetch(`${host}/api/tags`);

    if (!response.ok) {
      return {
        available: false,
        models: [],
      };
    }

    const payload = await response.json();
    return {
      available: true,
      models: payload.models ?? [],
    };
  } catch {
    return {
      available: false,
      models: [],
    };
  }
}

function findModel(models, selectedModel) {
  const exact = models.find((model) => model.name === selectedModel);

  if (exact) {
    return {
      available: true,
      name: exact.name,
    };
  }

  return {
    available: false,
    name: selectedModel,
  };
}
