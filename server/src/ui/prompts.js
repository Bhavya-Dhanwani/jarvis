// Import the promise-based readline interface for CLI prompts.
import { createInterface } from 'node:readline/promises';

// Manage interactive prompts for one setup run.
export class PromptSession {
  // Create a prompt session around input and output streams.
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    // Store output for validation messages.
    this.output = output;
    // Create the readline interface for questions.
    this.readline = createInterface({ input, output });
  }

  // Ask a yes/no question with a default answer.
  async confirm(question, { defaultValue = false } = {}) {
    // Pick the visual suffix based on the default value.
    const suffix = defaultValue ? 'Y/n' : 'y/N';

    // Keep asking until the user gives a valid yes/no answer.
    while (true) {
      // Read and normalize the answer.
      const answer = (await this.readline.question(`${question} (${suffix}) `)).trim().toLowerCase();

      // Use the default answer when the user presses Enter.
      if (!answer) {
        // Return the configured default.
        return defaultValue;
      }

      // Accept yes answers.
      if (['y', 'yes'].includes(answer)) {
        // Return true for confirmation.
        return true;
      }

      // Accept no answers.
      if (['n', 'no'].includes(answer)) {
        // Return false for rejection.
        return false;
      }

      // Ask again after invalid input.
      this.output.write('Please answer yes or no.\n');
    }
  }

  // Ask a free-form question with optional default and validation.
  async ask(question, { defaultValue, validate } = {}) {
    // Show the default value when provided.
    const suffix = defaultValue ? ` [${defaultValue}]` : '';

    // Keep asking until validation passes.
    while (true) {
      // Read the raw answer from the user.
      const raw = await this.readline.question(`${question}${suffix}: `);
      // Use trimmed input or the default value.
      const answer = raw.trim() || defaultValue || '';
      // Run optional validation.
      const error = validate?.(answer);

      // Return the answer when validation succeeds.
      if (!error) {
        // Return the accepted answer.
        return answer;
      }

      // Print validation errors and ask again.
      this.output.write(`${error}\n`);
    }
  }

  // Close the underlying readline interface.
  close() {
    // Release readline resources.
    this.readline.close();
  }
}
