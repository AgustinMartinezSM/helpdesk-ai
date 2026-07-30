import { createHash } from 'node:crypto';
import type { TicketContext, TicketContextMessage } from '../domain/suggestion';
import type { SourceTicketSnapshot } from './ports/ticket-source';

/**
 * Turns a ticket as its owning service returns it into the only thing a
 * provider is allowed to see.
 *
 * Two jobs, both deliberately in one place so no provider can skip either:
 *
 * 1. **Redaction.** Internal notes are dropped. This service reads them —
 *    it calls tickets-service as a staff user — so excluding them has to be
 *    an explicit act (ADR 0011). Author identity is reduced to a role:
 *    a model needs to know who is asking and who is answering, not user ids.
 * 2. **Bounding.** Long fields and long threads are truncated to fixed
 *    limits, which caps the size (and therefore the cost) of any request
 *    regardless of how a ticket grew.
 */

/** Roughly a short paragraph — enough to identify the request. */
const MAX_TITLE = 200;
/** Roughly two screens of text; longer descriptions are cut with a marker. */
const MAX_DESCRIPTION = 2_000;
const MAX_MESSAGE_BODY = 800;
/** The most recent messages carry the state of the conversation. */
const MAX_MESSAGES = 12;

export const CONTEXT_LIMITS = {
  title: MAX_TITLE,
  description: MAX_DESCRIPTION,
  messageBody: MAX_MESSAGE_BODY,
  messages: MAX_MESSAGES,
} as const;

export function buildTicketContext(
  snapshot: SourceTicketSnapshot,
): TicketContext {
  const { ticket } = snapshot;
  const publicComments = snapshot.comments.filter(
    (comment) => !comment.internal,
  );

  // Keep the NEWEST messages when a thread is too long, then restore
  // chronological order: a model reading a conversation backwards
  // misattributes cause and effect.
  const kept = publicComments.slice(-MAX_MESSAGES);

  const messages: TicketContextMessage[] = kept.map((comment) => ({
    authorRole: comment.authorId === ticket.requesterId ? 'requester' : 'staff',
    body: truncate(comment.body, MAX_MESSAGE_BODY).text,
    at: comment.createdAt,
  }));

  const title = truncate(ticket.title, MAX_TITLE);
  const description = truncate(ticket.description, MAX_DESCRIPTION);
  const bodyTruncated = kept.some(
    (comment) => truncate(comment.body, MAX_MESSAGE_BODY).truncated,
  );

  return {
    ticketId: ticket.id,
    title: title.text,
    description: description.text,
    status: ticket.status,
    currentPriority: ticket.priority,
    currentCategory: ticket.category,
    messages,
    truncated:
      title.truncated ||
      description.truncated ||
      bodyTruncated ||
      kept.length < publicComments.length,
  };
}

/**
 * Stable fingerprint of the exact context a provider saw.
 *
 * Stored instead of the text itself (ADR 0011): it tells two suggestions
 * apart and makes a bad answer reproducible, without copying another
 * service's data of record into this database. Field names are included so
 * that moving a value between fields changes the hash.
 */
export function hashTicketContext(context: TicketContext): string {
  return createHash('sha256').update(JSON.stringify(context)).digest('hex');
}

interface Truncation {
  text: string;
  truncated: boolean;
}

/** Cuts at the last word boundary before the limit, marking the cut so a
 * prompt can say the text is partial rather than pretending it is whole. */
function truncate(value: string, max: number): Truncation {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return { text: trimmed, truncated: false };
  }
  const hardCut = trimmed.slice(0, max);
  const lastSpace = hardCut.lastIndexOf(' ');
  const body = lastSpace > max * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return { text: `${body.trimEnd()}…`, truncated: true };
}
