import {
  baseEnvSchema,
  corsOriginsSchema,
  z,
} from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'web-bff';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('WEB_BFF_ENV');

export const webBffEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // The web application is the only browser client of this BFF.
  CORS_ALLOWED_ORIGINS: corsOriginsSchema('http://localhost:3000'),
});

export type WebBffEnv = z.infer<typeof webBffEnvSchema>;
