const LOGO = String.raw`
       __     ______     ______     __   __   __     ______
      /\ \   /\  __ \   /\  == \   /\ \ / /  /\ \   /\  ___\
     _\_\ \  \ \  __ \  \ \  __<   \ \ \'/   \ \ \  \ \___  \
    /\_____\  \ \_\ \_\  \ \_\ \_\  \ \__|    \ \_\  \/\_____\
    \/_____/   \/_/\/_/   \/_/ /_/   \/_/      \/_/   \/_____/
`;

export function getJarvisLogo() {
  return LOGO;
}

export async function playBootSequence({ output = process.stdout, delay = wait } = {}) {
  output.write('\n');
  for (const line of LOGO.split('\n')) {
    output.write(`${line}\n`);
    await delay(25);
  }

  output.write('\n');
  await typewriter('Initializing local intelligence core...', { output, speed: 18, delay });
  await typewriter('Scanning host system...', { output, speed: 18, delay });
}

export async function typewriter(message, { output = process.stdout, speed = 14, delay = wait } = {}) {
  for (const char of message) {
    output.write(char);
    await delay(speed);
  }
  output.write('\n');
}

export function banner(message, { output = process.stdout } = {}) {
  output.write(`\n[ JARVIS ] ${message}\n`);
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
