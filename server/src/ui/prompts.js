import prompts from 'prompts';
import { createInterface } from 'node:readline/promises';
import { panel, theme, warningBox } from './theme.js';

export class PromptSession {
  constructor({ input = process.stdin, output = process.stdout } = {}) {
    this.input = input;
    this.output = output;
    this.readline = input.isTTY === true ? null : createInterface({ input, output });
  }

  async confirm(question, { defaultValue = false, hint } = {}) {
    if (this.readline) {
      const suffix = defaultValue ? 'Y/n' : 'y/N';
      const answer = (await this.readline.question(`${question} (${suffix}) `)).trim().toLowerCase();

      if (!answer) {
        return defaultValue;
      }

      return ['y', 'yes'].includes(answer);
    }

    this.output.write('\n');
    this.output.write(panel(`${theme.title(question)}${hint ? `\n${theme.muted(hint)}` : ''}`, {
      borderColor: defaultValue ? 'cyan' : 'yellow',
      title: theme.cyan('CONFIRMATION REQUIRED'),
    }));
    this.output.write('\n');

    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message: theme.primary('Authorize action?'),
      initial: defaultValue,
    }, {
      stdin: this.input,
      stdout: this.output,
      onCancel: () => ({ value: false }),
    });

    return response.value === true;
  }

  async ask(question, { defaultValue, validate } = {}) {
    if (this.readline) {
      while (true) {
        const suffix = defaultValue ? ` [${defaultValue}]` : '';
        const answer = ((await this.readline.question(`${question}${suffix}: `)).trim() || defaultValue || '');
        const error = validate?.(answer);

        if (!error) {
          return answer;
        }

        this.output.write(`${error}\n`);
      }
    }

    const response = await prompts({
      type: 'text',
      name: 'value',
      message: theme.primary(question),
      initial: defaultValue,
      validate(value) {
        const answer = String(value ?? '').trim();
        return validate?.(answer) || true;
      },
    }, {
      stdin: this.input,
      stdout: this.output,
      onCancel: () => ({ value: defaultValue ?? '' }),
    });

    return String(response.value ?? defaultValue ?? '').trim();
  }

  async secret(question, { validate } = {}) {
    if (this.readline) {
      while (true) {
        const answer = (await this.readline.question(`${question}: `)).trim();
        const error = validate?.(answer);

        if (!error) {
          return answer;
        }

        this.output.write(`${error}\n`);
      }
    }

    const response = await prompts({
      type: 'password',
      name: 'value',
      message: theme.primary(question),
      validate(value) {
        const answer = String(value ?? '').trim();
        return validate?.(answer) || true;
      },
    }, {
      stdin: this.input,
      stdout: this.output,
      onCancel: () => ({ value: '' }),
    });

    return String(response.value ?? '').trim();
  }

  async select(question, choices, { initial = 0 } = {}) {
    if (this.readline) {
      return choices[initial]?.value;
    }

    const response = await prompts({
      type: 'select',
      name: 'value',
      message: theme.primary(question),
      choices,
      initial,
      hint: theme.muted('Use arrow keys, press Enter to select'),
    }, {
      stdin: this.input,
      stdout: this.output,
      onCancel: () => ({ value: choices[initial]?.value }),
    });

    return response.value;
  }

  warn(message) {
    this.output.write(warningBox(message));
  }

  close() {
    this.readline?.close();
  }
}
