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
  // Single entry point into the platform; the BFF never calls domain
  // services directly.
  GATEWAY_URL: z
    .string()
    .url()
    .default('http://localhost:3002')
    .transform((value) => value.replace(/\/+$/, '')),
  // false in local development (plain http); MUST be true wherever the BFF
  // is served over https.
  SESSION_COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  // How long the browser keeps the refresh cookie. Mirrors auth-service's
  // JWT_REFRESH_TTL_SECONDS default; the server-side token remains the
  // real authority on expiry.
  SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .default(1209600),
});

export type WebBffEnv = z.infer<typeof webBffEnvSchema>;
