export const CHAT_COMMANDS = [
  ['/commands', 'Show available Jarvis chat commands'],
  ['/code <request>', 'Run coding agents in this workspace'],
  ['/run <command>', 'Run a command in this workspace'],
  ['/git push [args]', 'Push the current Git branch'],
  ['/exit', 'Save and close session'],
  ['/quit', 'Save and close session'],
];
// Print CLI help text.
export function printHelp(output = console.log) {
  // Send usage instructions to the chosen output function.
  output(`Jarvis CLI

Usage:
  jarvis                         Start a new chat session
  jarvis resume                  Resume the most recent chat session
  jarvis code "<request>"        Run a coding request through the agent workflow
  jarvis commands                Show commands available inside chat
  jarvis doctor                  Check local system and Ollama readiness
  jarvis setup                   Run guided first-run local AI setup

Options:
  -h, --help                     Show help
  -v, --version                  Show version`);
}

// Print commands available inside an interactive Jarvis session.
export function printCommands(output = console.log) {
  output(`Jarvis chat commands

${CHAT_COMMANDS.map(([command, description]) => `  ${command.padEnd(22)} ${description}`).join('\n')}`);
}

// Print the package version.
export function printVersion(packageInfo, output = console.log) {
  // Send the version string to the chosen output function.
  output(packageInfo.version);
}
