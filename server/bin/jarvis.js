#!/usr/bin/env node

import { runCli } from '../src/cli/index.js';

runCli(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
