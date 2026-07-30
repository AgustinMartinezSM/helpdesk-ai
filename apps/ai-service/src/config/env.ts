import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'ai-service';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('AI_SERVICE_ENV');

/**
 * Model providers this build can select (ADR 0010).
 *
 * `local` is a deterministic keyword-and-template provider: no network, no
 * spend, same input -> same output. It is a real implementation of the
 * provider port, not a mock, and it is labeled as itself everywhere its
 * output appears.
 *
 * Connecting a paid provider adds its id here and its credentials below —
 * required only when that provider is the selected one, so an unused
 * credential never becomes a mandatory variable.
 */
export const AI_PROVIDERS = ['local'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const aiServiceEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3009),
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
  // Ticket content is read from tickets-service with the caller's own token
  // (ADR 0011); there is deliberately no service credential to configure.
  TICKETS_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3004')
    .transform((value) => value.replace(/\/+$/, '')),
  AI_PROVIDER: z.enum(AI_PROVIDERS).default('local'),
});

export type AiServiceEnv = z.infer<typeof aiServiceEnvSchema>;
