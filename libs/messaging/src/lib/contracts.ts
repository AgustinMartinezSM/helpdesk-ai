import { z } from '@helpdesk-ai/configuration';

/**
 * One event contract = one routing key. The version suffix is part of the
 * name: changing a payload shape means introducing a new contract (v2) and
 * publishing both until every consumer has migrated — never mutating v1.
 */
export interface EventContract<
  TType extends string = string,
  TPayload = unknown,
> {
  readonly type: TType;
  readonly payloadSchema: z.ZodType<TPayload>;
}

export function defineEvent<TType extends string, TPayload>(
  type: TType,
  payloadSchema: z.ZodType<TPayload>,
): EventContract<TType, TPayload> {
  return { type, payloadSchema };
}

/**
 * Wire format shared by every event. `payload` stays opaque here; it is
 * validated separately against the contract selected by `type`.
 *
 * Cross-cutting facts about the *delivery* live here rather than in a
 * payload, because a payload belongs to one contract and these do not.
 * `correlationId` was the first; `organizationId` is the second.
 *
 * Putting the tenant here rather than in each payload is deliberate. Every
 * contract names its subject differently — `ticketId`, `userId`,
 * `suggestionId` — so a consumer that reads events it has no schema for
 * (the audit trail does exactly that) could not find the tenant in a payload
 * without knowing every contract. On the envelope it is in one place for all
 * of them, present or absent.
 *
 * Both are optional **on this schema**, which is shared by every version of
 * every event. Requiring a tenant is a property of the v2 publish path and,
 * later, of the v2 consume path — it cannot be a property of a schema that
 * still has to accept every v1 message unchanged.
 */
export const eventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  occurredAt: z.iso.datetime(),
  correlationId: z.string().min(1).optional(),
  organizationId: z.uuid().optional(),
  payload: z.unknown(),
});

export interface EventEnvelope<
  TType extends string = string,
  TPayload = unknown,
> {
  readonly id: string;
  readonly type: TType;
  readonly occurredAt: string;
  readonly correlationId?: string;
  /** Tenant this event belongs to. Present on v2 events, absent on v1. */
  readonly organizationId?: string;
  readonly payload: TPayload;
}

/** Envelope type carried by a given contract. */
export type ContractEnvelope<TContract> =
  TContract extends EventContract<infer TType, infer TPayload>
    ? EventEnvelope<TType, TPayload>
    : never;

// ---------------------------------------------------------------------------
// Contracts. Status/priority vocabularies are duplicated from the owning
// service's domain ON PURPOSE: a contract is the public agreement between
// services and must not import any one service's internals — a domain
// refactor that changes these words is a breaking contract change (v2).
//
// The v1/v2 pairs below share one payload schema each. Their payloads are
// identical by construction, not by discipline: the only difference between
// the two versions is the type string — which is the routing key, so an
// existing v1 binding never receives a v2 message — and the tenant on the
// envelope. Copying the schema instead would leave two definitions free to
// drift during a compatibility window that spans several phases.
//
// `user.registered` has no v2, on purpose. Registration is anonymous and the
// membership that would supply a tenant is created by *consuming* that very
// event, so a tenant cannot exist when it is published. See
// docs/architecture/messaging.md.
// ---------------------------------------------------------------------------

export const userRegisteredV1 = defineEvent(
  'user.registered.v1',
  z.object({
    userId: z.uuid(),
    email: z.email(),
    roles: z.array(z.string().min(1)).min(1),
    registeredAt: z.iso.datetime(),
  }),
);

const ticketStatus = z.enum(['open', 'in_progress', 'resolved', 'closed']);
const ticketPriority = z.enum(['low', 'medium', 'high', 'urgent']);

const ticketCreatedPayload = z.object({
  ticketId: z.uuid(),
  requesterId: z.uuid(),
  title: z.string().min(1),
  priority: ticketPriority,
  status: ticketStatus,
  createdAt: z.iso.datetime(),
});

export const ticketCreatedV1 = defineEvent(
  'ticket.created.v1',
  ticketCreatedPayload,
);
export const ticketCreatedV2 = defineEvent(
  'ticket.created.v2',
  ticketCreatedPayload,
);

const ticketStatusChangedPayload = z.object({
  ticketId: z.uuid(),
  actorId: z.uuid(),
  fromStatus: ticketStatus,
  toStatus: ticketStatus,
  changedAt: z.iso.datetime(),
});

export const ticketStatusChangedV1 = defineEvent(
  'ticket.status-changed.v1',
  ticketStatusChangedPayload,
);
export const ticketStatusChangedV2 = defineEvent(
  'ticket.status-changed.v2',
  ticketStatusChangedPayload,
);

const ticketAssignedPayload = z.object({
  ticketId: z.uuid(),
  actorId: z.uuid(),
  /** Null means the ticket was unassigned. */
  assigneeId: z.uuid().nullable(),
  assignedAt: z.iso.datetime(),
});

export const ticketAssignedV1 = defineEvent(
  'ticket.assigned.v1',
  ticketAssignedPayload,
);
export const ticketAssignedV2 = defineEvent(
  'ticket.assigned.v2',
  ticketAssignedPayload,
);

const ticketCommentAddedPayload = z.object({
  ticketId: z.uuid(),
  commentId: z.uuid(),
  authorId: z.uuid(),
  internal: z.boolean(),
  addedAt: z.iso.datetime(),
});

export const ticketCommentAddedV1 = defineEvent(
  'ticket.comment-added.v1',
  ticketCommentAddedPayload,
);
export const ticketCommentAddedV2 = defineEvent(
  'ticket.comment-added.v2',
  ticketCommentAddedPayload,
);

/**
 * A model answered something about a ticket. Metadata only — no summary
 * text, no draft, no rationale: the suggestion itself is read from
 * ai-service by a caller whose token authorizes it (ADR 0011), so this
 * event cannot become a side channel around that check. The task/provider
 * vocabulary is duplicated from ai-service's domain for the usual reason:
 * a contract must not import a service's internals.
 */
const aiSuggestionCreatedPayload = z.object({
  suggestionId: z.uuid(),
  ticketId: z.uuid(),
  task: z.enum(['summary', 'classification', 'priority', 'reply']),
  /** Provider id and model that produced it, e.g. 'local'/'heuristics-v1'. */
  provider: z.string().min(1),
  model: z.string().min(1),
  requestedBy: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const aiSuggestionCreatedV1 = defineEvent(
  'ai.suggestion.created.v1',
  aiSuggestionCreatedPayload,
);
export const aiSuggestionCreatedV2 = defineEvent(
  'ai.suggestion.created.v2',
  aiSuggestionCreatedPayload,
);
