#!/usr/bin/env node
import { runProgram } from '../interface/cli/program.js';

const main = async (): Promise<void> => {
  const result = await runProgram(process.argv);
  process.exit(result.exitCode);
};

void main();
