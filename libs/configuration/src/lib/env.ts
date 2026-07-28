import { z } from 'zod';

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Variables every backend service needs, regardless of its domain.
 *
 * Services extend this schema with their own variables instead of sharing a
 * single global environment file, so each service owns and documents its own
 * configuration surface.
 */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVIRONMENTS).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

/**
 * Parses a comma-separated list of allowed CORS origins.
 * Kept here because every HTTP service needs the same parsing rules.
 */
export function corsOriginsSchema(defaultOrigins: string) {
  return z
    .string()
    .default(defaultOrigins)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    );
}
