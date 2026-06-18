import cliProgress from 'cli-progress';
import { theme } from './theme.js';

export async function withProgress(message, action, {
  output = process.stdout,
  durationMs = 1200,
} = {}) {
  if (!output.isTTY) {
    output.write(`${message}\n`);
    return action();
  }

  const bar = new cliProgress.SingleBar({
    format: `${theme.cyan('{bar}')} ${theme.title('{percentage}%')} ${theme.muted('|')} ${theme.primary(message)}`,
    barCompleteChar: '#',
    barIncompleteChar: '-',
    clearOnComplete: true,
    hideCursor: true,
  }, cliProgress.Presets.shades_classic);

  let value = 0;
  let completed = false;
  const checkpoints = [
    6, 12, 18, 24, 30, 36, 42, 48,
    54, 60, 66, 72, 78, 84, 90, 92,
  ];
  let checkpointIndex = 0;
  bar.start(100, 0);

  const timer = setInterval(() => {
    if (completed || checkpointIndex >= checkpoints.length) {
      return;
    }

    value = checkpoints[checkpointIndex];
    checkpointIndex += 1;
    bar.update(value);
  }, Math.max(80, Math.round(durationMs / checkpoints.length)));

  try {
    const result = await action();
    completed = true;
    clearInterval(timer);
    await updateCompletionSteps(bar);
    bar.update(100);
    bar.stop();
    output.write(`${theme.success('OK')} ${theme.title(message)}\n`);
    return result;
  } catch (error) {
    completed = true;
    clearInterval(timer);
    bar.stop();
    throw error;
  }
}

async function updateCompletionSteps(bar) {
  for (const value of [95, 99]) {
    bar.update(value);
    await wait(120);
  }
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
