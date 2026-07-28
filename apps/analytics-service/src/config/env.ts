import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'analytics-service';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('ANALYTICS_SERVICE_ENV');

export const analyticsServiceEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3008),
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
});

export type AnalyticsServiceEnv = z.infer<typeof analyticsServiceEnvSchema>;
