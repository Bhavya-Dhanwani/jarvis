// Print CLI help text.
export function printHelp(output = console.log) {
  // Send usage instructions to the chosen output function.
  output(`Jarvis CLI

Usage:
  jarvis          Start a new chat session
  jarvis resume   Resume the most recent chat session
  jarvis doctor   Check local system and Ollama readiness
  jarvis setup    Run guided first-run local AI setup

Options:
  -h, --help      Show help
  -v, --version   Show version`);
}

// Print the package version.
export function printVersion(packageInfo, output = console.log) {
  // Send the version string to the chosen output function.
  output(packageInfo.version);
}
