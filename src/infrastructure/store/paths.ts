import os from 'node:os';
import path from 'node:path';

export const resolveCdtHome = (): string => {
  const fromEnv = process.env.CDT_HOME;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv;
  }
  return path.join(os.homedir(), '.cdt');
};

export const resolveBrokerDir = (homeDir = resolveCdtHome()): string => path.join(homeDir, 'broker');
export const resolveContextsDir = (homeDir = resolveCdtHome()): string => path.join(homeDir, 'contexts');
export const resolveLocksDir = (homeDir = resolveCdtHome()): string => path.join(homeDir, 'locks');

export const resolveDaemonSocketPath = (homeDir = resolveCdtHome()): string =>
  path.join(resolveBrokerDir(homeDir), 'daemon.sock');

export const resolveDaemonPidPath = (homeDir = resolveCdtHome()): string =>
  path.join(resolveBrokerDir(homeDir), 'daemon.pid');

export const resolveDaemonLockPath = (homeDir = resolveCdtHome()): string =>
  path.join(resolveBrokerDir(homeDir), 'daemon.lock');

export const resolveDaemonLogPath = (homeDir = resolveCdtHome()): string =>
  path.join(resolveBrokerDir(homeDir), 'daemon.log');

export const resolveContextDir = (contextKeyHash: string, homeDir = resolveCdtHome()): string =>
  path.join(resolveContextsDir(homeDir), contextKeyHash);

export const resolveContextMetadataPath = (contextKeyHash: string, homeDir = resolveCdtHome()): string =>
  path.join(resolveContextDir(contextKeyHash, homeDir), 'metadata.json');

export const resolveContextLeasePath = (contextKeyHash: string, homeDir = resolveCdtHome()): string =>
  path.join(resolveContextDir(contextKeyHash, homeDir), 'lease.json');

export const resolveContextLockPath = (contextKeyHash: string, homeDir = resolveCdtHome()): string =>
  path.join(resolveLocksDir(homeDir), `context-${contextKeyHash}.lock`);
