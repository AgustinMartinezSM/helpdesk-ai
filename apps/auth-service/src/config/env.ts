import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'auth-service';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('AUTH_SERVICE_ENV');

export const authServiceEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3003),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith('postgresql://') || value.startsWith('postgres://'),
      { message: 'must be a PostgreSQL connection URL' },
    ),
  // No default on purpose: a service must never boot with a guessable
  // signing secret.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86400)
    .default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().min(3600).default(1209600),
});

export type AuthServiceEnv = z.infer<typeof authServiceEnvSchema>;
