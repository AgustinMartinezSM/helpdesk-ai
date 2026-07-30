import { AiDomainErrorFilter } from '../app/suggestions/ai-domain-error.filter';
import {
  ProviderUnavailableError,
  TicketSourceUnavailableError,
} from './errors';
import {
  clearRegisteredSecrets,
  describeExternalError,
  redactSecrets,
  registerSecret,
} from './redaction';

/**
 * Every credential below is synthetic. They are shaped like the real thing
 * because the pattern rules key off that shape, but none of them is valid and
 * no test reads a value out of the environment.
 */
const GOOGLE_SHAPED_KEY = 'AIzaSyFAKE00000000000000000000000000000';
const OPAQUE_KEY = 'test-key-0000-not-a-real-credential';
const OAUTH_TOKEN = 'ya29.FAKE00000000000000000000000000';

afterEach(() => {
  clearRegisteredSecrets();
});

describe('redactSecrets', () => {
  it('removes a registered key that has no recognizable shape', () => {
    // The only layer that can catch this one: nothing about the string says
    // "credential" until you know what was configured.
    registerSecret(OPAQUE_KEY);

    const output = redactSecrets(`request failed for key ${OPAQUE_KEY}`);

    expect(output).not.toContain(OPAQUE_KEY);
    expect(output).toContain('[redacted]');
  });

  it('removes a credential nobody registered, from its shape alone', () => {
    // The path that protects code which never sees the key.
    const output = redactSecrets(`API key not valid: ${GOOGLE_SHAPED_KEY}`);

    expect(output).not.toContain(GOOGLE_SHAPED_KEY);
    expect(output).toContain('API key not valid');
  });

  it.each([
    ['google api key', `key ${GOOGLE_SHAPED_KEY} rejected`, GOOGLE_SHAPED_KEY],
    ['oauth token', `token ${OAUTH_TOKEN} expired`, OAUTH_TOKEN],
    [
      'x-goog-api-key header',
      `sent headers {"x-goog-api-key":"${OPAQUE_KEY}"}`,
      OPAQUE_KEY,
    ],
    [
      'authorization header',
      `authorization: Bearer ${OPAQUE_KEY}\nhost: example.test`,
      OPAQUE_KEY,
    ],
    ['bare bearer token', `Authorization = Bearer ${OPAQUE_KEY}`, OPAQUE_KEY],
    [
      'env-style assignment',
      `GEMINI_API_KEY=${OPAQUE_KEY} was not accepted`,
      OPAQUE_KEY,
    ],
    [
      'query string',
      `GET https://example.test/v1/models?key=${OPAQUE_KEY}&alt=json failed`,
      OPAQUE_KEY,
    ],
  ])('redacts a credential carried as %s', (_carrier, text, secret) => {
    // None of these is registered: shape alone has to be enough.
    const output = redactSecrets(text);

    expect(output).not.toContain(secret);
    expect(output).toContain('[redacted]');
  });

  it('keeps the label so a redacted message still explains itself', () => {
    const output = redactSecrets(`x-goog-api-key: ${OPAQUE_KEY}`);

    // Redaction that destroys the diagnosis moves the outage from the log to
    // the person reading it.
    expect(output).toContain('x-goog-api-key');
    expect(output).not.toContain(OPAQUE_KEY);
  });

  it('leaves ordinary diagnostic text untouched', () => {
    // The failure mode opposite to leaking: a rule broad enough to swallow
    // the information someone needs to fix the outage.
    const messages = [
      'HTTP 429 (rate limited or out of quota): Quota exceeded for requests per day',
      'connect ETIMEDOUT 142.250.0.1:443',
      'the response contained no model output',
      'output.text: String must contain at most 600 character(s)',
      'the access token was rejected while reading the ticket',
    ];

    for (const message of messages) {
      expect(redactSecrets(message)).toBe(message);
    }
  });

  it('is safe to apply twice', () => {
    registerSecret(OPAQUE_KEY);
    const once = redactSecrets(`key ${OPAQUE_KEY}`);

    expect(redactSecrets(once)).toBe(once);
  });

  it('ignores an empty registered secret instead of shredding the message', () => {
    // Splitting on '' would splice the marker between every character.
    registerSecret('');

    expect(redactSecrets('a normal message')).toBe('a normal message');
  });
});

describe('describeExternalError', () => {
  it('follows a nested cause and redacts what it finds there', () => {
    // Where undici puts the interesting part — and, when a request is echoed,
    // the header that carried the credential.
    const error = new Error('fetch failed', {
      cause: new Error(`sent authorization: Bearer ${OPAQUE_KEY}`),
    });

    const detail = describeExternalError(error);

    expect(detail).toContain('fetch failed');
    expect(detail).not.toContain(OPAQUE_KEY);
    expect(detail).toContain('[redacted]');
  });

  it('serializes a thrown object rather than reporting [object Object]', () => {
    const thrown = {
      message: 'request rejected',
      headers: { 'x-goog-api-key': OPAQUE_KEY },
    };

    const detail = describeExternalError(thrown);

    expect(detail).toContain('request rejected');
    expect(detail).not.toContain(OPAQUE_KEY);
  });

  it('never carries a stack fragment', () => {
    const detail = describeExternalError(new Error('boom'));

    expect(detail).toBe('boom');
    expect(detail).not.toContain('at ');
  });

  it('survives a cyclic cause chain and an unserializable value', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(describeExternalError(cyclic)).toBe('[unserializable value]');

    const looping = new Error('outer');
    looping.cause = looping;
    expect(() => describeExternalError(looping)).not.toThrow();
  });

  it('caps a detail so an upstream body cannot become the message', () => {
    const detail = describeExternalError(new Error('x'.repeat(5_000)));

    expect(detail.length).toBeLessThanOrEqual(501);
  });
});

describe('the AiDomainError boundary', () => {
  it('redacts on construction, so no call site can bypass it', () => {
    registerSecret(OPAQUE_KEY);

    // Deliberately passing a raw credential the way a careless refactor would.
    const error = new ProviderUnavailableError('gemini', `key ${OPAQUE_KEY}`);

    expect(error.message).not.toContain(OPAQUE_KEY);
    expect(error.message).toContain('gemini');
  });

  it('covers errors raised far from the provider adapter', () => {
    // tickets-service forwards the caller's own bearer token, so its failures
    // are a second way a credential could reach a response.
    const error = new TicketSourceUnavailableError(
      `upstream echoed authorization: Bearer ${OPAQUE_KEY}`,
    );

    expect(error.message).not.toContain(OPAQUE_KEY);
  });

  it('keeps a structured log serialization clean', () => {
    registerSecret(OPAQUE_KEY);
    const error = new ProviderUnavailableError('gemini', `key ${OPAQUE_KEY}`);

    // `stack` embeds `message`, which is why redacting on the way in matters
    // more than redacting at each exit.
    const serialized = JSON.stringify({
      err: { type: error.name, message: error.message, stack: error.stack },
    });

    expect(serialized).not.toContain(OPAQUE_KEY);
  });

  it('keeps the client-facing response body clean', () => {
    registerSecret(OPAQUE_KEY);
    const error = new ProviderUnavailableError(
      'gemini',
      `HTTP 400: API key not valid: ${OPAQUE_KEY}`,
    );

    let body: unknown;
    let status = 0;
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({
          status(code: number) {
            status = code;
            return {
              json(payload: unknown) {
                body = payload;
              },
            };
          },
        }),
      }),
    } as unknown as Parameters<AiDomainErrorFilter['catch']>[1];

    new AiDomainErrorFilter().catch(error, host);

    expect(status).toBe(503);
    expect(JSON.stringify(body)).not.toContain(OPAQUE_KEY);
    // Still useful: the caller can tell a bad key from an outage.
    expect(JSON.stringify(body)).toContain('API key not valid');
  });
});
