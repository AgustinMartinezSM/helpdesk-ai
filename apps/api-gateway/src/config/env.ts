import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'api-gateway';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('API_GATEWAY_ENV');

export const apiGatewayEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  // Downstream service the gateway routes /api/auth/* to.
  AUTH_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3003')
    .transform((value) => value.replace(/\/+$/, '')),
  // Downstream service the gateway routes /api/tickets/* to.
  TICKETS_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3004')
    .transform((value) => value.replace(/\/+$/, '')),
  // Downstream service the gateway routes /api/users/* to.
  USERS_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3005')
    .transform((value) => value.replace(/\/+$/, '')),
  // Downstream service the gateway routes /api/audit/* to.
  AUDIT_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3006')
    .transform((value) => value.replace(/\/+$/, '')),
  // Downstream service the gateway routes /api/notifications/* to.
  NOTIFICATION_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3007')
    .transform((value) => value.replace(/\/+$/, '')),
  // Downstream service the gateway routes /api/analytics/* to.
  ANALYTICS_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3008')
    .transform((value) => value.replace(/\/+$/, '')),
  // Downstream service the gateway routes /api/ai/* to.
  AI_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3009')
    .transform((value) => value.replace(/\/+$/, '')),
  // Downstream service the gateway routes /api/organizations/* to.
  ORGANIZATIONS_SERVICE_URL: z
    .string()
    .url()
    .default('http://localhost:3010')
    .transform((value) => value.replace(/\/+$/, '')),
});

export type ApiGatewayEnv = z.infer<typeof apiGatewayEnvSchema>;
