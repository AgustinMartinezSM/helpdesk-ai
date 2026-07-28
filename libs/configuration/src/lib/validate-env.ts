import type { z } from 'zod';

/**
 * Raised when the process environment does not satisfy a service's schema.
 * Carries one human-readable line per offending variable so startup logs
 * point directly at what must be fixed.
 */
export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates an environment source (usually process.env) against a schema.
 *
 * Call this at the very top of a service's bootstrap, before any framework
 * wiring: a misconfigured service must refuse to start with a clear error
 * instead of failing later at request time.
 */
export function validateEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: Record<string, unknown>,
): z.infer<TSchema> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }
  return result.data as z.infer<TSchema>;
}
