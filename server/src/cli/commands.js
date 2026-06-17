export function printHelp(output = console.log) {
  output(`Jarvis CLI

Usage:
  jarvis          Start a new chat session
  jarvis resume   Resume the most recent chat session

Options:
  -h, --help      Show help
  -v, --version   Show version`);
}

export function printVersion(packageInfo, output = console.log) {
  output(packageInfo.version);
}
