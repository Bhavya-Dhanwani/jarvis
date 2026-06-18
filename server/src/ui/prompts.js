import { createInterface } from 'node:readline/promises';

export class PromptSession {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    this.output = output;
    this.readline = createInterface({ input, output });
  }

  async confirm(question, { defaultValue = false } = {}) {
    const suffix = defaultValue ? 'Y/n' : 'y/N';

    while (true) {
      const answer = (await this.readline.question(`${question} (${suffix}) `)).trim().toLowerCase();

      if (!answer) {
        return defaultValue;
      }

      if (['y', 'yes'].includes(answer)) {
        return true;
      }

      if (['n', 'no'].includes(answer)) {
        return false;
      }

      this.output.write('Please answer yes or no.\n');
    }
  }

  async ask(question, { defaultValue, validate } = {}) {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';

    while (true) {
      const raw = await this.readline.question(`${question}${suffix}: `);
      const answer = raw.trim() || defaultValue || '';
      const error = validate?.(answer);

      if (!error) {
        return answer;
      }

      this.output.write(`${error}\n`);
    }
  }

  close() {
    this.readline.close();
  }
}
