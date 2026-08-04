import { validateEnv, EnvValidationError } from '@helpdesk-ai/configuration';
import { authServiceEnvSchema } from './env';

const BASE = {
  DATABASE_URL: 'postgresql://auth_service:secret@localhost:5433/helpdesk_auth',
  RABBITMQ_URL: 'amqp://helpdesk:secret@localhost:5672',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  INTERNAL_SERVICE_TOKEN: 'test-internal-0123456789abcdef0123456789',
};

function parse(overrides: Record<string, unknown> = {}) {
  return validateEnv(authServiceEnvSchema, { ...BASE, ...overrides });
}

/** BASE minus one variable — how "somebody forgot to set it" is spelled. */
function without(key: keyof typeof BASE): Record<string, unknown> {
  const source: Record<string, unknown> = { ...BASE };
  delete source[key];
  return source;
}

/**
 * The two credentials this service cannot boot without, pinned as a pair.
 *
 * `INTERNAL_SERVICE_TOKEN` became required in Sprint 10.8, and the reason it
 * needs a test rather than a comment is the shape of the failure it replaces:
 * an unset credential produced a service that started fine, logged one
 * warning, and then minted tenant-less tokens forever, so the product failed
 * at every write with a 403 naming nothing. That is invisible in a way a
 * refused boot is not.
 */
describe('auth-service environment', () => {
  it('accepts a complete environment and defaults the ports and TTLs', () => {
    const env = parse();

    expect(env.PORT).toBe(3003);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.ORGANIZATIONS_SERVICE_URL).toBe('http://localhost:3010');
  });

  it('refuses to start without INTERNAL_SERVICE_TOKEN, and names it', () => {
    const withoutToken = without('INTERNAL_SERVICE_TOKEN');

    expect(() => validateEnv(authServiceEnvSchema, withoutToken)).toThrow(
      EnvValidationError,
    );
    expect(() => validateEnv(authServiceEnvSchema, withoutToken)).toThrow(
      /INTERNAL_SERVICE_TOKEN/,
    );
  });

  it('refuses a short INTERNAL_SERVICE_TOKEN rather than accepting a weak one', () => {
    expect(() => parse({ INTERNAL_SERVICE_TOKEN: 'too-short' })).toThrow(
      /INTERNAL_SERVICE_TOKEN/,
    );
  });

  it('has NO default for either credential', () => {
    // A default in a public repository is a guessable credential. This is the
    // property, stated as a test because it is the kind of thing a later
    // "developer convenience" commit undoes without noticing.
    expect(() =>
      validateEnv(authServiceEnvSchema, without('JWT_ACCESS_SECRET')),
    ).toThrow(/JWT_ACCESS_SECRET/);
    const parsed = authServiceEnvSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it('caps a shared-workstation session at the normal refresh lifetime', () => {
    // The shared flag can only ever SHRINK a session (SessionService takes a
    // min()), so a larger value here is inert rather than dangerous — pinned
    // because the schema alone would happily accept it.
    const env = parse({
      JWT_REFRESH_TTL_SECONDS: 1209600,
      JWT_REFRESH_SHARED_TTL_SECONDS: 43200,
    });

    expect(env.JWT_REFRESH_SHARED_TTL_SECONDS).toBeLessThan(
      env.JWT_REFRESH_TTL_SECONDS,
    );
  });
});
