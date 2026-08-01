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
  /**
   * Tenant this event belongs to. Present on every tenant-carrying contract
   * (the v2s and the membership events); absent on user.registered.v1 and
   * on the archived legacy v1 envelopes the trail still replays.
   */
  readonly organizationId?: string;
  readonly payload: TPayload;
}

/** Envelope type carried by a given contract. */
export type ContractEnvelope<TContract> =
  TContract extends EventContract<infer TType, infer TPayload>
    ? EventEnvelope<TType, TPayload>
    : never;

/**
 * Raised by `requireEnvelopeOrganization` when a tenant-carrying event
 * arrives without a tenant on its envelope.
 */
export class MissingTenantContextError extends Error {
  constructor(type: string) {
    super(`event "${type}" carries no organizationId on its envelope`);
    this.name = 'MissingTenantContextError';
  }
}

/**
 * Consume-side guard for tenant-carrying events.
 *
 * The envelope schema cannot require a tenant — it is shared with every v1
 * message still on the bus — so the requirement lives where the consumer
 * knows the contract it subscribed to is tenant-carrying. Throwing rather
 * than returning undefined is the point: inside a subscribe handler the
 * throw rejects the delivery to the DLQ, so a tenantless envelope becomes an
 * inspectable dead letter instead of a projected row no organization owns.
 */
export function requireEnvelopeOrganization(envelope: EventEnvelope): string {
  if (!envelope.organizationId) {
    throw new MissingTenantContextError(envelope.type);
  }
  return envelope.organizationId;
}

// ---------------------------------------------------------------------------
// Contracts. Status/priority vocabularies are duplicated from the owning
// service's domain ON PURPOSE: a contract is the public agreement between
// services and must not import any one service's internals — a domain
// refactor that changes these words is a breaking contract change (v2).
//
// v2 is the only published revision of the ticket and ai events below.
// Phase 8 closed the dual-publish compatibility window: the v1 definitions
// are deleted, nothing publishes their routing keys, and the durable queues
// unbind them on boot. The type strings keep the `.v2` suffix even so,
// because renaming a contract in place is exactly what ADR 0005 forbids —
// the suffix is history (a tenantless v1 once shared the bus), not a
// promise that a parallel v1 still exists.
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

export const ticketCreatedV2 = defineEvent(
  'ticket.created.v2',
  z.object({
    ticketId: z.uuid(),
    requesterId: z.uuid(),
    title: z.string().min(1),
    priority: ticketPriority,
    status: ticketStatus,
    createdAt: z.iso.datetime(),
  }),
);

export const ticketStatusChangedV2 = defineEvent(
  'ticket.status-changed.v2',
  z.object({
    ticketId: z.uuid(),
    actorId: z.uuid(),
    fromStatus: ticketStatus,
    toStatus: ticketStatus,
    changedAt: z.iso.datetime(),
  }),
);

export const ticketAssignedV2 = defineEvent(
  'ticket.assigned.v2',
  z.object({
    ticketId: z.uuid(),
    actorId: z.uuid(),
    /** Null means the ticket was unassigned. */
    assigneeId: z.uuid().nullable(),
    assignedAt: z.iso.datetime(),
  }),
);

export const ticketCommentAddedV2 = defineEvent(
  'ticket.comment-added.v2',
  z.object({
    ticketId: z.uuid(),
    commentId: z.uuid(),
    authorId: z.uuid(),
    internal: z.boolean(),
    addedAt: z.iso.datetime(),
  }),
);

/**
 * A model answered something about a ticket. Metadata only — no summary
 * text, no draft, no rationale: the suggestion itself is read from
 * ai-service by a caller whose token authorizes it (ADR 0011), so this
 * event cannot become a side channel around that check. The task/provider
 * vocabulary is duplicated from ai-service's domain for the usual reason:
 * a contract must not import a service's internals.
 */
export const aiSuggestionCreatedV2 = defineEvent(
  'ai.suggestion.created.v2',
  z.object({
    suggestionId: z.uuid(),
    ticketId: z.uuid(),
    task: z.enum(['summary', 'classification', 'priority', 'reply']),
    /** Provider id and model that produced it, e.g. 'local'/'heuristics-v1'. */
    provider: z.string().min(1),
    model: z.string().min(1),
    requestedBy: z.uuid(),
    createdAt: z.iso.datetime(),
  }),
);

// ---------------------------------------------------------------------------
// Membership events. Born tenant-carrying: no consumer predates them, so
// there is no v1/v2 compatibility window to manage — ".v1" names the first
// version of a tenant-carrying contract, not a tenantless past. The envelope
// organizationId is required on the publish path exactly as for the ticket
// v2 contracts (ADR 0005 amendment), and consumers reject its absence with
// `requireEnvelopeOrganization`.
//
// The organization ALSO appears in the payload, unlike the ticket contracts.
// Not a contradiction: a membership IS an (organization, user) edge, so the
// organization is the subject of the fact, not merely the scope of its
// delivery. The envelope copy is for consumers that route on tenancy without
// knowing this schema; the payload copy is the fact itself.
//
// roleTemplate and status are min-1 strings, not enums, on purpose: the
// role-template vocabulary is still an open question (see the pending
// decisions in docs/handoffs/CURRENT-HANDOFF.md), and freezing today's
// provisional names into a contract enum would turn settling it into a
// breaking contract change.
// ---------------------------------------------------------------------------

export const membershipCreatedV1 = defineEvent(
  'membership.created.v1',
  z.object({
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    userId: z.uuid(),
    roleTemplate: z.string().min(1),
    status: z.string().min(1),
    createdAt: z.iso.datetime(),
  }),
);

export const membershipStatusChangedV1 = defineEvent(
  'membership.status-changed.v1',
  z.object({
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    userId: z.uuid(),
    fromStatus: z.string().min(1),
    toStatus: z.string().min(1),
    /** Post-transition membership version; compares against the `mv` claim. */
    version: z.number().int().positive(),
    changedAt: z.iso.datetime(),
  }),
);

/**
 * A membership's role template changed. Everything the membership block
 * above says holds here too: born tenant-carrying, organization on the
 * envelope AND in the payload, templates as min-1 strings because the
 * vocabulary is still unfrozen.
 *
 * Both templates travel so a consumer can project the change without
 * re-reading the row — the same reason status-changed carries both statuses.
 */
export const membershipRoleChangedV1 = defineEvent(
  'membership.role-changed.v1',
  z.object({
    membershipId: z.uuid(),
    organizationId: z.uuid(),
    userId: z.uuid(),
    fromTemplate: z.string().min(1),
    toTemplate: z.string().min(1),
    /** Post-change membership version; compares against the `mv` claim. */
    version: z.number().int().positive(),
    changedAt: z.iso.datetime(),
  }),
);

// ---------------------------------------------------------------------------
// Branch and station events (ADR 0016). Born tenant-carrying, exactly like
// the membership contracts above: no consumer predates them, ".v1" names the
// first version of a tenant-carrying contract, the envelope organizationId is
// required on the publish path, and consumers reject its absence with
// `requireEnvelopeOrganization`.
//
// The organization ALSO appears in the payload, for the membership reason: a
// branch belongs to exactly one organization by construction, and the
// consumer these exist for — tickets-service's `branch_refs`/`station_refs`
// projection — keys every row by tenant, so the payload states the fact
// rather than making the projector reach for the envelope.
//
// `code`, `status` (and `area`) are min-1 strings, not enums, for the
// role-template reason: the place vocabulary is service-internal, and
// freezing today's words into the contract would turn renaming one into a
// breaking contract change.
//
// There is one `updated` contract per subject, not a lifecycle family
// (`archived`, `renamed`, ...), on purpose: an archive IS an update to
// `status`, and the consumers project last-write state — they replace their
// row with whatever the event says, so distinct routing keys per kind of
// change would multiply contracts without telling anyone anything the
// payload does not already say.
// ---------------------------------------------------------------------------

export const branchCreatedV1 = defineEvent(
  'branch.created.v1',
  z.object({
    branchId: z.uuid(),
    organizationId: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
    timezone: z.string().min(1).optional(),
    createdAt: z.iso.datetime(),
  }),
);

export const branchUpdatedV1 = defineEvent(
  'branch.updated.v1',
  z.object({
    branchId: z.uuid(),
    organizationId: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
    timezone: z.string().min(1).optional(),
    updatedAt: z.iso.datetime(),
  }),
);

export const stationCreatedV1 = defineEvent(
  'station.created.v1',
  z.object({
    stationId: z.uuid(),
    branchId: z.uuid(),
    organizationId: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    area: z.string().min(1).optional(),
    status: z.string().min(1),
    createdAt: z.iso.datetime(),
  }),
);

export const stationUpdatedV1 = defineEvent(
  'station.updated.v1',
  z.object({
    stationId: z.uuid(),
    branchId: z.uuid(),
    organizationId: z.uuid(),
    code: z.string().min(1),
    name: z.string().min(1),
    area: z.string().min(1).optional(),
    status: z.string().min(1),
    updatedAt: z.iso.datetime(),
  }),
);

// ---------------------------------------------------------------------------
// Profile events. NOT tenant-carrying by name, deliberately: a person-level
// profile edit can legitimately happen with no organization — the
// belongs-nowhere state fixes their own phone number — so the envelope
// carries the organization when the actor has one and the audit trail
// records the rest with null, exactly the user.registered.v1 shape.
//
// The payload names WHICH keys changed and never the values: a value in an
// event would sit in the audit trail's jsonb forever (see the retention note
// in data-ownership.md), and no consumer needs it — the trail records that a
// change happened, the profile itself is the record of what it is now.
// ---------------------------------------------------------------------------

export const profileUpdatedV1 = defineEvent(
  'profile.updated.v1',
  z.object({
    userId: z.uuid(),
    /** Person-level column names and/or organization field keys. */
    changedKeys: z.array(z.string().min(1)).min(1),
    updatedAt: z.iso.datetime(),
  }),
);
