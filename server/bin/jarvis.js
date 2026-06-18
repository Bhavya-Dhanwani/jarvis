#!/usr/bin/env node

// Import the main CLI runner.
import { runCli } from '../src/cli/index.js';

// Run the CLI with command-line arguments.
runCli(process.argv.slice(2)).catch((error) => {
  // Print only the error message for clean CLI output.
  console.error(error.message);
  // Mark the process as failed.
  process.exitCode = 1;
});
