import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'tickets-service';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('TICKETS_SERVICE_ENV');

export const ticketsServiceEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3004),
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
  // Must match auth-service's signing secret: this service only VERIFIES
  // access tokens, it never mints them.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  // Assignee verification calls organizations-service directly, the one
  // synchronous internal call this service makes (reserved by ADR 0014 for
  // high-consequence mutations). Both values below must be present to build
  // the verifier; while either is missing the service still boots but
  // refuses assignment — fail closed, see app.module.
  ORGANIZATIONS_SERVICE_URL: z
    .string()
    .url()
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
  // Identifies this process to organizations-service; must equal that
  // service's INTERNAL_SERVICE_TOKEN. Optional with no default, for the same
  // reason auth-service's is: a default would be a guessable credential
  // shipped in the repository.
  INTERNAL_SERVICE_TOKEN: z
    .string()
    .min(32, 'must be at least 32 characters')
    .optional(),
});

export type TicketsServiceEnv = z.infer<typeof ticketsServiceEnvSchema>;
