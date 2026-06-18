import ora from 'ora';
import { createSpinner } from 'nanospinner';
import { theme } from './theme.js';

export async function withSpinner(message, action, { output = process.stdout } = {}) {
  if (!output.isTTY) {
    output.write(`${message}\n`);
    return action();
  }

  const spinner = ora({
    text: theme.primary(message),
    color: 'cyan',
    spinner: 'dots12',
  }).start();

  try {
    const result = await action();
    spinner.succeed(theme.success(message));
    return result;
  } catch (error) {
    spinner.fail(theme.error(message));
    throw error;
  }
}

export async function loading(message, { output = process.stdout, durationMs = 650 } = {}) {
  if (!output.isTTY) {
    output.write(`${message}\n`);
    return;
  }

  const spinner = createSpinner(theme.primary(message), {
    color: 'cyan',
  }).start();

  await wait(durationMs);
  spinner.success({ text: theme.success(message) });
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
