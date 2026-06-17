import packageInfo from '../../package.json' with { type: 'json' };
import { printHelp, printVersion } from './commands.js';
import { parseCommand } from './parser.js';

export async function runCli(args, context = {}) {
  const command = parseCommand(args);
  const output = context.output ?? console.log;

  if (command.command === 'help') {
    printHelp(output);
    return { status: 'ok' };
  }

  if (command.command === 'version') {
    printVersion(packageInfo, output);
    return { status: 'ok' };
  }

  if (command.command === 'unknown') {
    throw new Error(`${command.error}\nRun "jarvis --help" for usage.`);
  }

  if (command.command === 'new') {
    output('Jarvis chat persistence is not initialized yet.');
    return { status: 'pending', command: 'new' };
  }

  if (command.command === 'resume') {
    output('Jarvis resume is not initialized yet.');
    return { status: 'pending', command: 'resume' };
  }

  throw new Error(`Unsupported command: ${command.command}`);
}
