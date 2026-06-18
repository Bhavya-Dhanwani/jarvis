import figlet from 'figlet';
import { cyberGradient, muted, panel, theme } from './theme.js';

export function getJarvisLogo(text = 'JARVIS') {
  return figlet.textSync(text, {
    font: 'ANSI Shadow',
    horizontalLayout: 'default',
    verticalLayout: 'default',
  });
}

export async function playBootSequence({ output = process.stdout, delay = wait } = {}) {
  output.write('\n');
  output.write(`${cyberGradient(getJarvisLogo())}\n`);
  output.write(panel(`${theme.title('JARVIS SETUP WIZARD')}\n${muted('Local AI Core Installer')}`, {
    borderColor: 'cyan',
    padding: 1,
  }));
  output.write('\n\n');
  await typewriter('Initializing local intelligence core...', { output, speed: 12, delay });
  await typewriter('Synchronizing local runtime protocols...', { output, speed: 12, delay });
}

export async function playChatSequence({ output = process.stdout, mode = 'new', delay = wait } = {}) {
  output.write('\n');
  output.write(`${cyberGradient(getJarvisLogo('JARVIS'))}\n`);
  output.write(panel(`${theme.title(mode === 'resume' ? 'JARVIS SESSION RESUME' : 'JARVIS COMMAND INTERFACE')}\n${muted('Local AI Runtime Console')}`, {
    borderColor: mode === 'resume' ? 'magenta' : 'cyan',
    padding: 1,
  }));
  output.write('\n\n');
  await typewriter(mode === 'resume' ? 'Restoring active memory thread...' : 'Booting conversational interface...', {
    output,
    speed: 10,
    delay,
  });
}

export async function playDoctorSequence({ output = process.stdout, delay = wait } = {}) {
  output.write('\n');
  output.write(`${cyberGradient(getJarvisLogo('DOCTOR'))}\n`);
  output.write(panel(`${theme.title('JARVIS DIAGNOSTICS')}\n${muted('System and Runtime Health Scan')}`, {
    borderColor: 'cyan',
    padding: 1,
  }));
  output.write('\n\n');
  await typewriter('Scanning host system telemetry...', { output, speed: 10, delay });
}

export async function playOnlineSequence({ output = process.stdout, delay = wait } = {}) {
  output.write('\n');
  output.write(`${cyberGradient(getJarvisLogo('ONLINE'))}\n`);
  await typewriter('JARVIS is online. Local AI core ready.', { output, speed: 10, delay });
}

export async function typewriter(message, { output = process.stdout, speed = 14, delay = wait } = {}) {
  if (!output.isTTY) {
    output.write(`${message}\n`);
    return;
  }

  for (const char of message) {
    output.write(theme.primary(char));
    await delay(speed);
  }
  output.write('\n');
}

export function banner(message, { output = process.stdout } = {}) {
  output.write(panel(theme.success(message), { borderColor: 'green' }));
  output.write('\n');
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
