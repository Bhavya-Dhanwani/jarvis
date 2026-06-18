// Import model config builder for setup reports.
import { createModelConfig } from './modelConfigService.js';
// Import system report builder for setup readiness.
import { getSystemReport } from '../core/systemCheck.js';

// Build a non-interactive setup readiness report.
export async function getSetupReport() {
  // Get local system and Ollama CLI status.
  const system = await getSystemReport();
  // Create model config using detected memory.
  const modelConfig = createModelConfig({ totalMemoryGb: system.memory.totalGb });
  // Check whether the Ollama server is reachable.
  const ollamaServer = await checkOllamaServer(modelConfig.host);
  // Check whether the configured model is installed.
  const model = ollamaServer.available
    // Search installed models only when the server is reachable.
    ? findModel(ollamaServer.models, modelConfig.model)
    // Use null when models cannot be listed.
    : null;

  // Return structured readiness details.
  return {
    // Include system report.
    system,
    // Include selected model config.
    modelConfig,
    // Include Ollama server status.
    ollamaServer,
    // Include model status.
    model,
    // Mark ready only when CLI, server, and model are available.
    ready: system.ollama.available && ollamaServer.available && model?.available === true,
  };
}

// Format the setup report for terminal output.
export function formatSetupReport(report) {
  // Build the base report lines.
  const lines = [
    // Add heading.
    'Jarvis setup',
    // Add blank line.
    '',
    // Show Ollama CLI status.
    `Ollama CLI: ${report.system.ollama.available ? 'found' : 'missing'}`,
    // Show Ollama server status.
    `Ollama server: ${report.ollamaServer.available ? 'running' : 'not reachable'}`,
    // Show selected model.
    `Selected model: ${report.modelConfig.model}`,
    // Show context size.
    `Context: ${report.modelConfig.options.num_ctx}`,
    // Show temperature.
    `Temperature: ${report.modelConfig.options.temperature}`,
    // Show whether model is installed.
    `Model installed: ${report.model?.available ? 'yes' : 'no'}`,
    // Add blank line.
    '',
  ];

  // Return success instructions when everything is ready.
  if (report.ready) {
    // Tell the user JARVIS is ready.
    lines.push('Jarvis is ready. Run:');
    // Show the command to start chat.
    lines.push('  jarvis');
    // Join the report lines.
    return lines.join('\n');
  }

  // Add remediation heading.
  lines.push('Next steps:');

  // Give install steps when Ollama CLI is missing.
  if (!report.system.ollama.available) {
    // Tell user where to install Ollama.
    lines.push('  1. Install Ollama from https://ollama.com/download');
    // Remind user to refresh terminal PATH.
    lines.push('  2. Close and reopen the terminal after installing.');
  // Give server start steps when CLI exists but server is down.
  } else if (!report.ollamaServer.available) {
    // Tell user to start Ollama.
    lines.push('  1. Start Ollama.');
    // Give Windows app guidance.
    lines.push('     On Windows, open the Ollama app from the Start menu.');
    // Give CLI server guidance.
    lines.push('     Or run: ollama serve');
  // Give model pull step when model is missing.
  } else if (!report.model?.available) {
    // Tell user how to pull the configured model.
    lines.push(`  1. Pull the selected model: ollama pull ${report.modelConfig.model}`);
  }

  // Add blank line before optional overrides.
  lines.push('');
  // Add environment override heading.
  lines.push('Optional model override:');
  // Show PowerShell override syntax.
  lines.push('  PowerShell: $env:JARVIS_OLLAMA_MODEL="gemma4:e2b"');
  // Show Bash override syntax.
  lines.push('  Bash: export JARVIS_OLLAMA_MODEL="gemma4:e2b"');

  // Join the report lines.
  return lines.join('\n');
}

// Check the Ollama server API for installed tags.
async function checkOllamaServer(host) {
  // Attempt to fetch the tags endpoint.
  try {
    // Ask Ollama for models.
    const response = await fetch(`${host}/api/tags`);

    // Treat non-OK responses as unavailable.
    if (!response.ok) {
      // Return unavailable server status.
      return {
        // Mark server unavailable.
        available: false,
        // Return no models.
        models: [],
      };
    }

    // Parse the JSON response.
    const payload = await response.json();
    // Return server status and model list.
    return {
      // Mark server available.
      available: true,
      // Store the models array or a fallback.
      models: payload.models ?? [],
    };
  // Treat network errors as server unavailable.
  } catch {
    // Return unavailable server status.
    return {
      // Mark server unavailable.
      available: false,
      // Return no models.
      models: [],
    };
  }
}

// Find the configured model in the Ollama model list.
function findModel(models, selectedModel) {
  // Look for an exact model name match.
  const exact = models.find((model) => model.name === selectedModel);

  // Return available when an exact match exists.
  if (exact) {
    // Return the matched model details.
    return {
      // Mark model available.
      available: true,
      // Store the model name.
      name: exact.name,
    };
  }

  // Return missing status when no model matched.
  return {
    // Mark model unavailable.
    available: false,
    // Store the requested model name.
    name: selectedModel,
  };
}
