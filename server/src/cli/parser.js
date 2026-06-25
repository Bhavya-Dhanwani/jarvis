// Define all supported CLI commands.
const COMMANDS = new Set(['new', 'resume', 'code', 'commands', 'doctor', 'setup', 'change', 'help', 'version']);

// Parse raw CLI arguments into a command object.
export function parseCommand(args) {
  // Split the first argument from the remaining arguments.
  const [commandArg, ...rest] = args;

  // Default to a new chat when no command is supplied.
  if (!commandArg) {
    // Return the implicit new command.
    return { command: 'new', args: [] };
  }

  // Map help flags to the help command.
  if (commandArg === '--help' || commandArg === '-h') {
    // Return help with remaining args.
    return { command: 'help', args: rest };
  }

  // Map version flags to the version command.
  if (commandArg === '--version' || commandArg === '-v') {
    // Return version with remaining args.
    return { command: 'version', args: rest };
  }

  // Reject unsupported command names.
  if (!COMMANDS.has(commandArg)) {
    // Return an unknown command object with an error message.
    return {
      // Mark the command as unknown.
      command: 'unknown',
      // Preserve the original args.
      args,
      // Build the user-facing error.
      error: `Unknown command: ${commandArg}`,
    };
  }

  // Return the recognized command.
  return { command: commandArg, args: rest };
}
