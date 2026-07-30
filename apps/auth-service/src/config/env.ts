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
  RABBITMQ_URL: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith('amqp://') || value.startsWith('amqps://'),
      { message: 'must be an AMQP connection URL' },
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
  // Membership is resolved here while a token is minted (ADR 0014), directly
  // rather than through the api-gateway.
  ORGANIZATIONS_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3010')
    .transform((value) => value.replace(/\/+$/, '')),
  // Identifies this process to organizations-service. Deliberately not
  // JWT_ACCESS_SECRET: minting a token is the one moment with no caller token
  // to forward, so a process credential is unavoidable — but it should not be
  // the same key that signs people's sessions.
  //
  // Optional, with no default. A default would be a guessable credential
  // shipped in the repository, which is the reason JWT_ACCESS_SECRET has none
  // either. Leaving it unset means this service does not attempt resolution
  // at all and mints tokens without tenant claims — the same outcome as a
  // failed call, reached without inventing a secret. It has to become
  // required in the phase that makes the claims decide something.
  INTERNAL_SERVICE_TOKEN: z
    .string()
    .min(32, 'must be at least 32 characters')
    .optional(),
});

export type AuthServiceEnv = z.infer<typeof authServiceEnvSchema>;
