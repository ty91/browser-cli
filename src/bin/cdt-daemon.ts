#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';

import { BrokerDaemon } from '../infrastructure/ipc/BrokerDaemon.js';

const logPath = process.env.CDT_DAEMON_LOG;

const writeLog = async (message: string): Promise<void> => {
  if (!logPath) {
    return;
  }

  await appendFile(logPath, `[${new Date().toISOString()}] ${message}\n`);
};

const main = async (): Promise<void> => {
  const daemon = new BrokerDaemon({
    homeDir: process.env.CDT_HOME
  });

  await daemon.start();
  await writeLog(`daemon started pid=${process.pid}`);
};

main().catch(async (error: unknown) => {
  await writeLog(`daemon failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
