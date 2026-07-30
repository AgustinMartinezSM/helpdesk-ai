import { z } from '@helpdesk-ai/configuration';
import type {
  CorrelationHeaders,
  SourceTicketSnapshot,
  TicketSource,
} from '../../application/ports/ticket-source';
import {
  TicketAccessUnauthorizedError,
  TicketNotFoundError,
  TicketSourceUnavailableError,
} from '../../domain/errors';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../../domain/suggestion';

/**
 * Reads a ticket from tickets-service over HTTP, on behalf of the caller.
 *
 * The only credential in play is the caller's own access token (ADR 0011):
 * this class holds no key, so the set of tickets it can read is exactly the
 * set the caller can read. Authorization outcomes are translated, not
 * reinterpreted — a 403 from the ticket store becomes the same "not found"
 * this service reports for a missing ticket, because that service already
 * decided not to confirm existence to non-owners.
 *
 * The response is parsed, not trusted: a shape change upstream surfaces as
 * a clean unavailability error instead of an undefined field reaching a
 * prompt.
 */

const DEFAULT_TIMEOUT_MS = 5_000;

const responseSchema = z.object({
  ticket: z.object({
    id: z.string().min(1),
    title: z.string(),
    description: z.string(),
    status: z.enum(TICKET_STATUSES),
    priority: z.enum(TICKET_PRIORITIES),
    category: z.string().nullable(),
    requesterId: z.string().min(1),
    assigneeId: z.string().nullable(),
  }),
  comments: z.array(
    z.object({
      authorId: z.string().min(1),
      body: z.string(),
      internal: z.boolean(),
      // Serialized dates arrive as strings; kept as strings all the way to
      // the provider, which only ever displays them.
      createdAt: z.string().min(1),
    }),
  ),
});

export class HttpTicketSource implements TicketSource {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetch(
    ticketId: string,
    accessToken: string,
    correlation: CorrelationHeaders = {},
  ): Promise<SourceTicketSnapshot> {
    const url = `${this.baseUrl}/tickets/${encodeURIComponent(ticketId)}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          ...correlation,
          authorization: `Bearer ${accessToken}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      // Includes the timeout: one attempt, no retry. Retrying a read whose
      // caller is waiting only multiplies the latency they already feel.
      throw new TicketSourceUnavailableError(
        error instanceof Error ? error.message : String(error),
      );
    }

    if (response.status === 401) {
      throw new TicketAccessUnauthorizedError();
    }
    if (response.status === 403 || response.status === 404) {
      throw new TicketNotFoundError();
    }
    if (!response.ok) {
      throw new TicketSourceUnavailableError(
        `tickets-service responded ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new TicketSourceUnavailableError(
        'tickets-service returned a body that is not JSON',
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new TicketSourceUnavailableError(
        `unexpected ticket payload (${parsed.error.issues
          .map((issue) => issue.path.join('.') || 'body')
          .join(', ')})`,
      );
    }

    return parsed.data;
  }
}
