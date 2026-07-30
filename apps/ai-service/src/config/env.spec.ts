import { validateEnv, EnvValidationError } from '@helpdesk-ai/configuration';
import { aiServiceEnvSchema } from './env';

const BASE = {
  DATABASE_URL: 'postgresql://ai_service:secret@localhost:5433/helpdesk_ai',
  RABBITMQ_URL: 'amqp://helpdesk:secret@localhost:5672',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

function parse(overrides: Record<string, unknown> = {}) {
  return validateEnv(aiServiceEnvSchema, { ...BASE, ...overrides });
}

describe('ai-service environment', () => {
  it('defaults to the local provider and a free-tier model', () => {
    const env = parse();

    expect(env.AI_PROVIDER).toBe('local');
    expect(env.GEMINI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(env.PORT).toBe(3009);
  });

  it('does not require a Gemini key while the local provider is selected', () => {
    expect(() => parse({ AI_PROVIDER: 'local' })).not.toThrow();
    expect(parse({ AI_PROVIDER: 'local' }).GEMINI_API_KEY).toBeUndefined();
  });

  it('refuses to start on gemini without a key, and names the variable', () => {
    // Fail fast with a message that points at what to fix — an unauthenticated
    // provider would otherwise surface as a 503 on the first suggestion.
    expect(() => parse({ AI_PROVIDER: 'gemini' })).toThrow(EnvValidationError);
    expect(() => parse({ AI_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/);
  });

  it('accepts gemini with a key and lets the model be overridden', () => {
    const env = parse({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'not-a-real-key',
      GEMINI_MODEL: 'gemini-3.5-flash',
    });

    expect(env.AI_PROVIDER).toBe('gemini');
    expect(env.GEMINI_MODEL).toBe('gemini-3.5-flash');
  });

  it('rejects a provider this build has no adapter for', () => {
    expect(() => parse({ AI_PROVIDER: 'gpt-9' })).toThrow(/AI_PROVIDER/);
  });

  it('rejects an empty Gemini key instead of treating it as absent', () => {
    // A pasted-but-empty placeholder is a configuration mistake, not a choice.
    expect(() => parse({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: '' })).toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it('ignores variables it does not declare', () => {
    // Documents why a variable can be prepared in .env before the code that
    // reads it exists: the schema strips the rest of process.env.
    const env = parse({ SOME_FUTURE_PROVIDER_KEY: 'whatever' }) as Record<
      string,
      unknown
    >;

    expect(env.SOME_FUTURE_PROVIDER_KEY).toBeUndefined();
  });
});
