import { z } from 'zod';

export const outputSchema = z.enum(['json', 'text']);

export const callerContextSchema = z.object({
  runtimeContextId: z.string().min(1).optional(),
  pid: z.number().int().nonnegative(),
  ppid: z.number().int().nonnegative().optional(),
  tty: z.string().min(1).optional(),
  cwd: z.string().min(1)
});

export type CallerContext = z.infer<typeof callerContextSchema>;

export const daemonContextSchema = z.object({
  caller: callerContextSchema,
  shareGroup: z.string().min(1).optional(),
  contextId: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional()
});

export type DaemonContext = z.infer<typeof daemonContextSchema>;
