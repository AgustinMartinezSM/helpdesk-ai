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
  // Credential auth-service presents on /internal/*. Deliberately NOT
  // JWT_ACCESS_SECRET: this service verifies no user tokens — it has no
  // person-facing endpoint — and a process identity should not rest on the
  // key that signs people's sessions. Every other service declares
  // JWT_ACCESS_SECRET; this one does not, because it would never read it.
  INTERNAL_SERVICE_TOKEN: z.string().min(32, 'must be at least 32 characters'),
});

export type OrganizationsServiceEnv = z.infer<
  typeof organizationsServiceEnvSchema
>;
