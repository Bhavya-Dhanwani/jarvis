// Import Ollama model helpers.
import { getOllamaModels, hasModel, pullModel } from './ollama.js';

// Define the default model requested for first-run setup. This is a static fallback;
// the setup wizard normally picks the model that fits the detected machine.
export const DEFAULT_MODEL = 'qwen3:4b';

// Ensure the selected model is installed before setup completes.
export async function ensureModel(model, prompts, { output = process.stdout } = {}) {
  // Ask Ollama for the installed model list.
  const list = await getOllamaModels();

  // Fail early if the model list could not be inspected.
  if (!list.ok) {
    // Include the Ollama error output for helpful troubleshooting.
    throw new Error(`Could not inspect Ollama models: ${list.output}`);
  }

  // Continue immediately if the model already exists locally.
  if (hasModel(list.models, model)) {
    // Tell the user the selected model is ready.
    output.write(`Model core detected: ${model}\n`);
    // Return a result showing no pull was needed.
    return { pulled: false, model };
  }

  // Tell the user the model must be downloaded.
  output.write('Model core missing. Download authorization required.\n');
  // Ask before pulling because downloads can be large.
  const shouldPull = await prompts.confirm(`Pull model "${model}" now?`, { defaultValue: true });

  // Stop setup if the user declines the download.
  if (!shouldPull) {
    // Tell the user how to pull manually later.
    throw new Error(`Setup stopped. Pull "${model}" later with: ollama pull ${model}`);
  }

  // Pull the model using the Ollama CLI.
  const result = await pullModel(model);

  // Fail setup if the pull command failed.
  if (!result.ok) {
    // Prefer stderr from Ollama when available.
    throw new Error(result.stderr || `Failed to pull model "${model}".`);
  }

  // Return a result showing the model was downloaded.
  return { pulled: true, model };
}
