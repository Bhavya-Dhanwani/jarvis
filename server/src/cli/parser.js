const COMMANDS = new Set(['new', 'resume', 'doctor', 'help', 'version']);

export function parseCommand(args) {
  const [commandArg, ...rest] = args;

  if (!commandArg) {
    return { command: 'new', args: [] };
  }

  if (commandArg === '--help' || commandArg === '-h') {
    return { command: 'help', args: rest };
  }

  if (commandArg === '--version' || commandArg === '-v') {
    return { command: 'version', args: rest };
  }

  if (!COMMANDS.has(commandArg)) {
    return {
      command: 'unknown',
      args,
      error: `Unknown command: ${commandArg}`,
    };
  }

  return { command: commandArg, args: rest };
}
