const FRAMES = ['|', '/', '-', '\\'];

export async function withSpinner(message, action, { output = process.stdout, intervalMs = 90 } = {}) {
  if (!output.isTTY) {
    output.write(`${message}\n`);
    return action();
  }

  let index = 0;
  output.write(`${message} `);
  const timer = setInterval(() => {
    output.write(`\r${message} ${FRAMES[index % FRAMES.length]}`);
    index += 1;
  }, intervalMs);

  try {
    const result = await action();
    clearInterval(timer);
    output.write(`\r${message} done\n`);
    return result;
  } catch (error) {
    clearInterval(timer);
    output.write(`\r${message} failed\n`);
    throw error;
  }
}

export async function loading(message, { output = process.stdout, ticks = 8, intervalMs = 80 } = {}) {
  if (!output.isTTY) {
    output.write(`${message}\n`);
    return;
  }

  for (let index = 0; index < ticks; index += 1) {
    output.write(`\r${message} ${FRAMES[index % FRAMES.length]}`);
    await wait(intervalMs);
  }
  output.write(`\r${message} done\n`);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
