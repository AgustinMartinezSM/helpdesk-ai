import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'organizations-service';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('ORGANIZATIONS_SERVICE_ENV');

export const organizationsServiceEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      { message: 'must be a PostgreSQL connection URL' },
    ),
  RABBITMQ_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('amqp://') || value.startsWith('amqps://'),
      { message: 'must be an AMQP connection URL' },
    ),
  // Verification only — this service never signs. It gained a person-facing
  // surface in Sprint 9.8 (ADR 0019), so it now reads the same secret
  // auth-service signs access tokens with, like the six other services that
  // verify them.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Credential auth-service and tickets-service present on /internal/*.
  // Deliberately NOT JWT_ACCESS_SECRET even now that both are declared here:
  // one symmetric key standing for both "this person is authenticated" and
  // "this process is authenticated" would tie the two rotations together.
  INTERNAL_SERVICE_TOKEN: z.string().min(32, 'must be at least 32 characters'),
  // The value being rotated OUT, accepted alongside the current one so a
  // rotation does not need every caller restarted in the same instant.
  // Empty except during a rotation; no default, because a default here would
  // be a second guessable credential (see the runbook in SECURITY.md).
  INTERNAL_SERVICE_TOKEN_PREVIOUS: z
    .string()
    .min(32, 'must be at least 32 characters')
    .optional(),
});

export type OrganizationsServiceEnv = z.infer<
  typeof organizationsServiceEnvSchema
>;
