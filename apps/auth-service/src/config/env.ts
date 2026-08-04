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
  // Refresh lifetime when the client declares the machine shared (a store
  // till): a shift and a half instead of two weeks. The flag can only
  // shrink a session — SessionService caps every requested TTL at the
  // normal one — so a value above JWT_REFRESH_TTL_SECONDS is inert, not
  // dangerous.
  JWT_REFRESH_SHARED_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(43200),
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
  // REQUIRED since Sprint 10.8, and no default — a default would be a
  // guessable credential shipped in a public repository, which is why
  // JWT_ACCESS_SECRET has none either.
  //
  // It was optional from Sprint 9.2, with this comment promising it would
  // "become required in the phase that makes the claims decide something".
  // That phase was four sprints ago: the claims carry the tenant of every
  // write, the permission set behind every check, and since 10.6 which
  // organization somebody is working in. What optional actually bought was a
  // deployment that forgot the variable logging ONE warning at boot and then
  // minting tenant-less tokens forever — every write refused with a 403 that
  // names nothing, in the one service whose fail-closed rule is written into
  // ADR 0014. A missing credential is now a named boot failure, which is what
  // JWT_ACCESS_SECRET has always got.
  INTERNAL_SERVICE_TOKEN: z.string().min(32, 'must be at least 32 characters'),
});

export type AuthServiceEnv = z.infer<typeof authServiceEnvSchema>;
