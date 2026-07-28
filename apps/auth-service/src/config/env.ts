import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'auth-service';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('AUTH_SERVICE_ENV');

export const authServiceEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3003),
});

export type AuthServiceEnv = z.infer<typeof authServiceEnvSchema>;
