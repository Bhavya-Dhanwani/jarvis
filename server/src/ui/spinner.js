// Define spinner frames for terminal animations.
const FRAMES = ['|', '/', '-', '\\'];

// Run an async action while showing a spinner.
export async function withSpinner(message, action, { output = process.stdout, intervalMs = 90 } = {}) {
  // Avoid carriage-return animation for non-interactive streams.
  if (!output.isTTY) {
    // Print the message once for captured output.
    output.write(`${message}\n`);
    // Run and return the action result.
    return action();
  }

  // Track the current spinner frame.
  let index = 0;
  // Print the initial spinner message.
  output.write(`${message} `);
  // Start the spinner interval.
  const timer = setInterval(() => {
    // Rewrite the current line with the next frame.
    output.write(`\r${message} ${FRAMES[index % FRAMES.length]}`);
    // Advance to the next frame.
    index += 1;
  }, intervalMs);

  // Run the action and update the spinner result.
  try {
    // Await the wrapped action.
    const result = await action();
    // Stop the spinner interval.
    clearInterval(timer);
    // Print the success state.
    output.write(`\r${message} done\n`);
    // Return the action result.
    return result;
  // Convert failures into a failed spinner state before rethrowing.
  } catch (error) {
    // Stop the spinner interval.
    clearInterval(timer);
    // Print the failure state.
    output.write(`\r${message} failed\n`);
    // Rethrow the original error.
    throw error;
  }
}

// Show a short loading animation without wrapping an action.
export async function loading(message, { output = process.stdout, ticks = 8, intervalMs = 80 } = {}) {
  // Avoid carriage-return animation for non-interactive streams.
  if (!output.isTTY) {
    // Print the message once for captured output.
    output.write(`${message}\n`);
    // End immediately for non-TTY output.
    return;
  }

  // Loop for a fixed number of animation ticks.
  for (let index = 0; index < ticks; index += 1) {
    // Rewrite the current line with the spinner frame.
    output.write(`\r${message} ${FRAMES[index % FRAMES.length]}`);
    // Pause between frames.
    await wait(intervalMs);
  }
  // Print the final done state.
  output.write(`\r${message} done\n`);
}

// Wait for a number of milliseconds.
function wait(ms) {
  // Resolve after the timeout completes.
  return new Promise((resolve) => {
    // Schedule the resolver.
    setTimeout(resolve, ms);
  });
}
