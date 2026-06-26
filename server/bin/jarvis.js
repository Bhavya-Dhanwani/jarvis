#!/usr/bin/env node

// Import the main CLI runner.
import { renderCliError, runCli } from '../src/cli/index.js';

// Run the CLI with command-line arguments.
runCli(process.argv.slice(2)).catch((error) => {
  // Print a themed, action-oriented failure instead of raw thrown text.
  process.stderr.write(renderCliError(error));
  // Mark the process as failed.
  process.exitCode = 1;
});
