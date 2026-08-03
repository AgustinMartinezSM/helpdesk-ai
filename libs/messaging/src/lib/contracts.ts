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

/**
 * Support team events (Sprint 9.12, ADR 0022).
 *
 * A support team is the operational group that resolves a ticket, and it is
 * ORGANIZATION-owned — not branch-owned, which is what lets one central team
 * serve every store. It is deliberately not a department: a department is the
 * requester's area and belongs to exactly one branch.
 *
 * No `deleted` contract, like the branch and station pairs: archival is a
 * status and the update carries it.
 */
export const supportTeamCreatedV1 = defineEvent(
  'support-team.created.v1',
  z.object({
    teamId: z.uuid(),
    organizationId: z.uuid(),
    key: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
    createdAt: z.iso.datetime(),
  }),
);

export const supportTeamUpdatedV1 = defineEvent(
  'support-team.updated.v1',
  z.object({
    teamId: z.uuid(),
    organizationId: z.uuid(),
    key: z.string().min(1),
    name: z.string().min(1),
    status: z.string().min(1),
    updatedAt: z.iso.datetime(),
  }),
);

/**
 * The team's branch scope, as the WHOLE desired set rather than a delta.
 *
 * An EMPTY array is meaningful and is the organization-wide case — it does
 * not mean "no change". A consumer replaces what it holds, which is the same
 * converging shape the membership branch editor uses (Sprint 9.10, D8) and
 * the only one that survives a lost event without drifting.
 */
export const supportTeamScopeChangedV1 = defineEvent(
  'support-team.scope-changed.v1',
  z.object({
    teamId: z.uuid(),
    organizationId: z.uuid(),
    branchIds: z.array(z.uuid()),
    changedAt: z.iso.datetime(),
  }),
);

// ---------------------------------------------------------------------------
// Organization events (Sprint 10.5, ADR 0024). Born tenant-carrying, like
// every contract above them: an organization IS the tenant, so the envelope
// organizationId is required on the publish path and the payload states the
// same fact for consumers holding this schema.
//
// Their only consumer is the audit trail, and that is a sufficient one — the
// standing `people.import.completed.v1` already has. What makes them worth
// existing beside the membership contracts is that a role-changed event names
// the row that moved and never the person who moved it. Two rows changing
// template in one transaction says an administrator did some administration;
// only these say the organization changed hands, and by whose decision.
//
// Neither carries anything beyond ids, templates and the names the operation
// is ABOUT. A display name is the organization's own, chosen to be shown; it
// is not personal data, and recording the previous one is the difference
// between a trail that says a rename happened and one that says what it did.
// ---------------------------------------------------------------------------

export const organizationRenamedV1 = defineEvent(
  'organization.renamed.v1',
  z.object({
    organizationId: z.uuid(),
    /**
     * Present so the trail records that it did NOT move. The slug is what the
     * bootstrap lookup and every provisioning path key on, and a rename that
     * changed it would be a different event with a migration behind it.
     */
    slug: z.string().min(1),
    previousName: z.string().min(1),
    name: z.string().min(1),
    renamedByUserId: z.uuid(),
    renamedAt: z.iso.datetime(),
  }),
);

/**
 * The organization changed hands.
 *
 * Both memberships also publish `membership.role-changed.v1` — that is what
 * keeps the directory projection right — so this one deliberately does not
 * repeat the row ids. It records the decision: who handed it over, who has it
 * now, and what the receiver was a moment before, which is what an auditor
 * needs to reconstruct the state the transfer was authorized against.
 */
export const organizationOwnershipTransferredV1 = defineEvent(
  'organization.ownership-transferred.v1',
  z.object({
    organizationId: z.uuid(),
    /** By rule the previous owner; carried separately so the rule is auditable. */
    transferredByUserId: z.uuid(),
    previousOwnerUserId: z.uuid(),
    newOwnerUserId: z.uuid(),
    newOwnerPreviousRoleTemplate: z.string().min(1),
    transferredAt: z.iso.datetime(),
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

// ---------------------------------------------------------------------------
// Invitation events (Sprint 9.8). Born tenant-carrying, like the membership
// and structure contracts: an invitation exists only inside an organization,
// so the envelope organizationId is required on the publish path and the
// payload states the same fact for consumers that already hold this schema.
//
// What these payloads deliberately do NOT carry: the code, its hash, or the
// invited email address. audit-service binds the firehose with '#' and keeps
// payloads opaquely and indefinitely, so an address in a payload is an
// address retained forever — the same reasoning that keeps values out of
// profile.updated.v1. Who acted travels instead, because the point of these
// events is attribution: every step of bringing a person in names the person
// who took it.
//
// roleTemplate is a min-1 string for the membership-contract reason: the
// template vocabulary is still open, and an enum here would turn settling it
// into a breaking contract change.
// ---------------------------------------------------------------------------

export const invitationIssuedV1 = defineEvent(
  'invitation.issued.v1',
  z.object({
    invitationId: z.uuid(),
    organizationId: z.uuid(),
    roleTemplate: z.string().min(1),
    invitedByUserId: z.uuid(),
    expiresAt: z.iso.datetime(),
    issuedAt: z.iso.datetime(),
  }),
);

/**
 * A bulk import finished (Sprint 9.15).
 *
 * COUNTS ONLY. Every invitation the import created already published
 * `invitation.issued.v1`, so who was invited is attributable without this;
 * what this adds is that they arrived as one batch, by whose hand. Putting the
 * addresses here would copy a few hundred people's personal data into the
 * audit store — a second retention boundary — to answer a question the
 * per-invitation events already answer.
 *
 * Published only on a real run. A dry run writes nothing and is not an event:
 * an audit trail full of previews nobody applied is a trail nobody reads.
 */
export const peopleImportCompletedV1 = defineEvent(
  'people.import.completed.v1',
  z.object({
    organizationId: z.uuid(),
    importedByUserId: z.uuid(),
    total: z.number().int().nonnegative(),
    invited: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    completedAt: z.iso.datetime(),
  }),
);

/**
 * The invitation was redeemed. `membershipId` is present only when this
 * acceptance actually inserted a membership: someone who already belonged to
 * the organization consumes their invitation without a second row, and an
 * event claiming a membership id that names no new row would mislead every
 * consumer that projects one.
 */
export const invitationAcceptedV1 = defineEvent(
  'invitation.accepted.v1',
  z.object({
    invitationId: z.uuid(),
    organizationId: z.uuid(),
    acceptedByUserId: z.uuid(),
    membershipId: z.uuid().optional(),
    roleTemplate: z.string().min(1),
    acceptedAt: z.iso.datetime(),
  }),
);

export const invitationRevokedV1 = defineEvent(
  'invitation.revoked.v1',
  z.object({
    invitationId: z.uuid(),
    organizationId: z.uuid(),
    revokedByUserId: z.uuid(),
    revokedAt: z.iso.datetime(),
  }),
);
