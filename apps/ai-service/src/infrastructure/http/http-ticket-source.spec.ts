import {
  TicketAccessUnauthorizedError,
  TicketNotFoundError,
  TicketSourceUnavailableError,
} from '../../domain/errors';
import { HttpTicketSource } from './http-ticket-source';

const TICKET_ID = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';

const validPayload = {
  ticket: {
    id: TICKET_ID,
    title: 'Cannot sign in',
    description: 'Every attempt fails.',
    status: 'open',
    priority: 'medium',
    category: null,
    requesterId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
    assigneeId: null,
  },
  comments: [
    {
      authorId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
      body: 'Still failing.',
      internal: false,
      createdAt: '2026-07-29T09:00:00.000Z',
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function sourceWith(handler: (call: Call) => Promise<Response> | Response): {
  source: HttpTicketSource;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return Promise.resolve(handler(call));
  }) as unknown as typeof fetch;

  return {
    calls,
    source: new HttpTicketSource('http://tickets.test', 5_000, fetchImpl),
  };
}

describe('HttpTicketSource', () => {
  it('asks the ticket store for one ticket with the caller bearer token', async () => {
    const { source, calls } = sourceWith(() => jsonResponse(validPayload));

    const snapshot = await source.fetch(TICKET_ID, 'caller-token', {
      'x-trace-id': 'trace-1',
    });

    expect(snapshot).toEqual(validPayload);
    expect(calls[0].url).toBe(`http://tickets.test/tickets/${TICKET_ID}`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer caller-token');
    // Correlation is propagated so one user action stays one trace.
    expect(headers['x-trace-id']).toBe('trace-1');
  });

  it('never lets correlation headers override the authorization it sends', async () => {
    const { source, calls } = sourceWith(() => jsonResponse(validPayload));

    await source.fetch(TICKET_ID, 'caller-token', {
      authorization: 'Bearer someone-elses-token',
    });

    expect(
      (calls[0].init?.headers as Record<string, string>).authorization,
    ).toBe('Bearer caller-token');
  });

  it('reports a rejected token as unauthorized so the session can refresh', async () => {
    const { source } = sourceWith(() => jsonResponse({}, 401));

    await expect(source.fetch(TICKET_ID, 'stale')).rejects.toBeInstanceOf(
      TicketAccessUnauthorizedError,
    );
  });

  it('turns a refusal into "not found" so existence never leaks', async () => {
    for (const status of [403, 404]) {
      const { source } = sourceWith(() => jsonResponse({}, status));
      await expect(source.fetch(TICKET_ID, 'token')).rejects.toBeInstanceOf(
        TicketNotFoundError,
      );
    }
  });

  it('treats an upstream fault as unavailability', async () => {
    const { source } = sourceWith(() => jsonResponse({}, 500));

    await expect(source.fetch(TICKET_ID, 'token')).rejects.toBeInstanceOf(
      TicketSourceUnavailableError,
    );
  });

  it('treats a network failure as unavailability, with the reason attached', async () => {
    const { source } = sourceWith(() => {
      throw new Error('connect ECONNREFUSED');
    });

    await expect(source.fetch(TICKET_ID, 'token')).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it('refuses a payload whose shape changed instead of feeding it to a model', async () => {
    const { source } = sourceWith(() =>
      jsonResponse({
        ticket: { ...validPayload.ticket, status: 'archived' },
        comments: [],
      }),
    );

    await expect(source.fetch(TICKET_ID, 'token')).rejects.toBeInstanceOf(
      TicketSourceUnavailableError,
    );
  });

  it('refuses a body that is not JSON', async () => {
    const { source } = sourceWith(
      () => new Response('<html>gateway error</html>', { status: 200 }),
    );

    await expect(source.fetch(TICKET_ID, 'token')).rejects.toThrow(/not JSON/);
  });
});
