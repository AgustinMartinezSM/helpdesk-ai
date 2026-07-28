import { z } from 'zod';
import { baseEnvSchema, corsOriginsSchema } from './env.js';
import { EnvValidationError, validateEnv } from './validate-env.js';

describe('validateEnv', () => {
  it('applies documented defaults when variables are absent', () => {
    const env = validateEnv(baseEnvSchema, {});

    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('accepts explicit valid values', () => {
    const env = validateEnv(baseEnvSchema, {
      NODE_ENV: 'production',
      LOG_LEVEL: 'warn',
    });

    expect(env.NODE_ENV).toBe('production');
    expect(env.LOG_LEVEL).toBe('warn');
  });

  it('rejects invalid values and names the offending variable', () => {
    let caught: unknown;
    try {
      validateEnv(baseEnvSchema, { NODE_ENV: 'staging' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).message).toContain('NODE_ENV');
  });

  it('reports every invalid variable at once, not just the first', () => {
    const schema = baseEnvSchema.extend({
      PORT: z.coerce.number().int().min(1).max(65535),
    });

    let caught: unknown;
    try {
      validateEnv(schema, { NODE_ENV: 'staging', PORT: 'not-a-port' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(EnvValidationError);
    const validationError = caught as EnvValidationError;
    expect(validationError.issues).toHaveLength(2);
    expect(validationError.message).toContain('NODE_ENV');
    expect(validationError.message).toContain('PORT');
  });

  it('coerces numeric strings for extended port variables', () => {
    const schema = baseEnvSchema.extend({
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    });

    expect(validateEnv(schema, { PORT: '8080' }).PORT).toBe(8080);
    expect(validateEnv(schema, {}).PORT).toBe(3001);
  });
});

describe('corsOriginsSchema', () => {
  it('splits a comma-separated list and trims whitespace', () => {
    const schema = z.object({
      CORS_ALLOWED_ORIGINS: corsOriginsSchema('http://localhost:3000'),
    });

    const env = validateEnv(schema, {
      CORS_ALLOWED_ORIGINS: ' http://localhost:3000 , https://app.example.com ',
    });

    expect(env.CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
    ]);
  });

  it('falls back to the provided default when the variable is absent', () => {
    const schema = z.object({
      CORS_ALLOWED_ORIGINS: corsOriginsSchema('http://localhost:3000'),
    });

    expect(validateEnv(schema, {}).CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:3000',
    ]);
  });
});
