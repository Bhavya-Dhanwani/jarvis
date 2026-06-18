// Store the JARVIS ASCII logo as a raw string so backslashes stay intact.
const LOGO = String.raw`
       __     ______     ______     __   __   __     ______
      /\ \   /\  __ \   /\  == \   /\ \ / /  /\ \   /\  ___\
     _\_\ \  \ \  __ \  \ \  __<   \ \ \'/   \ \ \  \ \___  \
    /\_____\  \ \_\ \_\  \ \_\ \_\  \ \__|    \ \_\  \/\_____\
    \/_____/   \/_/\/_/   \/_/ /_/   \/_/      \/_/   \/_____/
`;

// Return the ASCII logo for callers that want to print it themselves.
export function getJarvisLogo() {
  // Return the raw logo text.
  return LOGO;
}

// Play the animated setup boot sequence.
export async function playBootSequence({ output = process.stdout, delay = wait } = {}) {
  // Add spacing before the logo.
  output.write('\n');
  // Print each logo line with a small delay.
  for (const line of LOGO.split('\n')) {
    // Write the current logo line.
    output.write(`${line}\n`);
    // Pause briefly to create an animation effect.
    await delay(25);
  }

  // Add spacing after the logo.
  output.write('\n');
  // Print the first boot message with a typewriter effect.
  await typewriter('Initializing local intelligence core...', { output, speed: 18, delay });
  // Print the scan message with a typewriter effect.
  await typewriter('Scanning host system...', { output, speed: 18, delay });
}

// Print text one character at a time.
export async function typewriter(message, { output = process.stdout, speed = 14, delay = wait } = {}) {
  // Iterate over each character in the message.
  for (const char of message) {
    // Write one character.
    output.write(char);
    // Pause between characters.
    await delay(speed);
  }
  // Finish the typewriter line.
  output.write('\n');
}

// Print a simple JARVIS-branded banner.
export function banner(message, { output = process.stdout } = {}) {
  // Write the banner message with spacing.
  output.write(`\n[ JARVIS ] ${message}\n`);
}

// Wait for a number of milliseconds.
function wait(ms) {
  // Resolve after the timeout completes.
  return new Promise((resolve) => {
    // Schedule the resolver.
    setTimeout(resolve, ms);
  });
}
