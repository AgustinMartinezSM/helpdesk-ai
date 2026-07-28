import { baseEnvSchema, z } from '@helpdesk-ai/configuration';

export const SERVICE_NAME = 'api-gateway';

/** Injection token for the validated, typed environment. */
export const APP_ENV = Symbol('API_GATEWAY_ENV');

export const apiGatewayEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3002),
});

export type ApiGatewayEnv = z.infer<typeof apiGatewayEnvSchema>;
