import type { MembershipStatus } from './membership';

export abstract class OrganizationDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Raised when an organization named by a caller does not exist. For the
 * bootstrap slug in the registration consumer this means the database was
 * provisioned wrong — the consumer lets it reject the message to the DLQ
 * instead of writing a membership pointing at nothing. On the internal HTTP
 * surface it is an ordinary 404: the caller named an organization this
 * database has never seen.
 */
export class OrganizationNotFoundError extends OrganizationDomainError {
  constructor(slugOrId: string) {
    super(`organization "${slugOrId}" not found`);
  }
}

export class MembershipNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, userId: string) {
    super(
      `user "${userId}" has no membership in organization "${organizationId}"`,
    );
  }

  /**
   * The same absence named by membership id — the shape station creation
   * validates a responsible manager with, where no userId is in hand.
   */
  static byId(
    organizationId: string,
    membershipId: string,
  ): MembershipNotFoundError {
    const error = new MembershipNotFoundError(organizationId, '');
    error.message = `membership "${membershipId}" not found in organization "${organizationId}"`;
    return error;
  }
}

/**
 * Raised when a status change is not an edge of the transition table —
 * including a target equal to the current status: the table has no
 * self-loops, so "already there" is a stale caller, not a success.
 */
export class InvalidMembershipTransitionError extends OrganizationDomainError {
  constructor(from: MembershipStatus, to: MembershipStatus) {
    super(`membership status cannot change from "${from}" to "${to}"`);
  }
}

// ---------------------------------------------------------------------------
// Member administration errors (Sprint 9.10). All three answer a caller who
// IS a member and is asking about their own reach, so each says why: there is
// nothing to conceal from someone being told what they may not do to a row
// they can already see. The 404 on a membership outside their organization is
// what keeps this surface from confirming which user ids belong where.
// ---------------------------------------------------------------------------

/**
 * Raised when the actor's token carries neither `people.suspend` nor
 * `people.assign_roles` nor `branches.manage_members`, whichever the
 * operation needed. In the use case rather than a route decorator, per
 * ADR 0015 rule 1 — a guard that has to be remembered per route is a guard
 * that gets forgotten.
 */
export class ForbiddenMembershipActionError extends OrganizationDomainError {
  constructor() {
    super('you are not allowed to manage memberships here');
  }
}

/**
 * Raised when the actor targets their own membership.
 *
 * This is what keeps an organization from losing its last administrator: the
 * actor must be an active member holding the key, and can never be the
 * target, so at least one privileged member survives any sequence of these
 * operations. A "count the remaining admins" check would race concurrent
 * requests; making the bad state unreachable does not (ADR 0021).
 */
export class SelfMembershipAdministrationError extends OrganizationDomainError {
  constructor() {
    super('you cannot change your own membership');
  }
}

/**
 * Raised when the TARGET's current template is out of the actor's reach.
 *
 * Two mechanisms answer with this one error: the ceiling, and the `owner`
 * exclusion the ceiling is blind to (owner and organization_admin resolve to
 * the same permission set, so a subset test would let an admin unseat the
 * owner). Naming the template is safe — the caller can already read it off
 * the directory.
 */
export class MembershipNotAdministrableError extends OrganizationDomainError {
  constructor(template: string) {
    super(`you cannot manage a member whose role template is "${template}"`);
  }
}

// ---------------------------------------------------------------------------
// Support team errors (Sprint 9.12, ADR 0022). A team is the group that
// RESOLVES a ticket, not the requester's department, so these are their own
// errors rather than structure ones — a message about managing branches would
// name the wrong concept to whoever was refused.
// ---------------------------------------------------------------------------

/** Raised when the actor's token carries no `teams.manage`. */
export class ForbiddenTeamActionError extends OrganizationDomainError {
  constructor() {
    super('you are not allowed to manage support teams here');
  }
}

/**
 * Raised when a team id names nothing in the caller's organization. Foreign
 * and nonexistent answer alike — confirming that another organization has a
 * team with this id is the leak.
 */
export class SupportTeamNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, teamId: string) {
    super(
      `support team "${teamId}" not found in organization "${organizationId}"`,
    );
  }
}

export class DuplicateSupportTeamCodeError extends OrganizationDomainError {
  constructor(organizationId: string, code: string) {
    super(
      `organization "${organizationId}" already has a support team with code "${code}"`,
    );
  }
}

/**
 * Raised when the actor's token carries neither `branches.create` nor
 * `branches.update` nor `branches.read`, whichever the operation needed.
 *
 * Separate from the membership one because the message has to name what was
 * refused, and because the two surfaces are gated by different keys — folding
 * them together would produce an error that lies about which one applied.
 */
export class ForbiddenStructureActionError extends OrganizationDomainError {
  constructor() {
    super('you are not allowed to manage this organization structure');
  }
}

// ---------------------------------------------------------------------------
// Structure errors (branches, departments, stations — Sprint 9.5). The
// not-found errors deliberately say nothing about whether the id exists in
// another organization: a foreign row and a nonexistent one answer alike,
// because confirming existence is the leak.
// ---------------------------------------------------------------------------

export class BranchNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, branchId: string) {
    super(`branch "${branchId}" not found in organization "${organizationId}"`);
  }
}

export class DuplicateBranchCodeError extends OrganizationDomainError {
  constructor(organizationId: string, code: string) {
    super(
      `organization "${organizationId}" already has a branch with code "${code}"`,
    );
  }
}

export class DepartmentNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, departmentId: string) {
    super(
      `department "${departmentId}" not found in organization "${organizationId}"`,
    );
  }
}

export class DuplicateDepartmentNameError extends OrganizationDomainError {
  constructor(branchId: string, name: string) {
    super(`branch "${branchId}" already has a department named "${name}"`);
  }
}

export class StationNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, stationId: string) {
    super(
      `station "${stationId}" not found in organization "${organizationId}"`,
    );
  }
}

export class DuplicateStationCodeError extends OrganizationDomainError {
  constructor(branchId: string, code: string) {
    super(`branch "${branchId}" already has a station with code "${code}"`);
  }
}

/**
 * Raised when a role change names a template outside ROLE_TEMPLATES. The DTO
 * already refuses unknown words with a 400; this guards the use case for
 * callers that never went through HTTP validation.
 */
export class InvalidRoleTemplateError extends OrganizationDomainError {
  constructor(template: string) {
    super(`"${template}" is not a role template`);
  }
}

// ---------------------------------------------------------------------------
// Invitation errors (Sprint 9.8). Two shapes, and the split is the security
// design rather than tidiness:
//
// - NOT FOUND covers an unknown id, a wrong secret and a foreign
//   organization's invitation alike. Anything finer turns the accept endpoint
//   into an oracle for valid invitation ids, and the revoke endpoint into one
//   for other organizations' rows.
// - NOT ACCEPTABLE covers every reason a real, addressed invitation may not
//   be redeemed right now — expired, already used, revoked, its issuer no
//   longer has standing, its organization was suspended. ONE error, blind to
//   the cause, because naming the cause tells someone who is not a member yet
//   what the organization's membership looks like. Same rule the assignee
//   validation settled in Sprint 9.4.
// ---------------------------------------------------------------------------

export class InvitationNotFoundError extends OrganizationDomainError {
  constructor() {
    super('invitation not found');
  }
}

/**
 * Raised when the actor's token carries no `people.invite`. The check lives
 * in the use case rather than a route decorator, following the platform's
 * rule that permission checks are server-side and at the call site — a guard
 * that has to be remembered per route is a guard that gets forgotten.
 */
export class ForbiddenInvitationActionError extends OrganizationDomainError {
  constructor() {
    super('you are not allowed to manage invitations here');
  }
}

export class InvitationNotRedeemableError extends OrganizationDomainError {
  constructor() {
    super('this invitation cannot be used');
  }
}

/**
 * Raised when a valid code is redeemed by someone other than the person it
 * was addressed to.
 *
 * Named rather than folded into the generic refusal above: signing in with
 * the wrong one of your own accounts is the common case, and whoever presents
 * the code already knows the code is real — so this tells them nothing they
 * could not deduce. It deliberately never names the address it expected.
 */
export class InvitationAddresseeMismatchError extends OrganizationDomainError {
  constructor() {
    super('this invitation was sent to a different address');
  }
}

/**
 * Raised when an organization already has a pending invitation for an
 * address. Backed by a partial unique index, so the check is not merely
 * advisory under concurrency — the database refuses the second one.
 */
export class DuplicatePendingInvitationError extends OrganizationDomainError {
  constructor(organizationId: string) {
    super(
      `organization "${organizationId}" already has a pending invitation for that address`,
    );
  }
}

/**
 * Raised when an issuer names a template their own carries no path to.
 * Distinct from the redemption refusals above: this one answers the ISSUER,
 * who is a member and already knows their own standing, so telling them why
 * leaks nothing and refusing silently would be unhelpful.
 */
export class RoleTemplateNotGrantableError extends OrganizationDomainError {
  constructor(template: string) {
    super(`you cannot grant the role template "${template}"`);
  }
}

/**
 * Raised when a role change targets the template the membership already has
 * — the status transition table's no-self-loop argument, applied to roles:
 * an "already there" request means the caller acted on a stale picture of
 * the row, and confirming it with a success would keep it stale. Writing
 * anyway would bump the version and invalidate every outstanding token over
 * a non-change.
 */
export class SameRoleTemplateError extends OrganizationDomainError {
  constructor(template: string) {
    super(`membership already has the role template "${template}"`);
  }
}

/*
 * `AlreadyBelongsToOrganizationError` lived here from Sprint 10.4 to 10.6.
 *
 * It refused a caller who already held a real membership, because resolution
 * picked the oldest one at every mint and a second organization would have
 * been unreachable by its own creator. ADR 0023 wrote the refusal down as
 * conditional and said to revisit it in the change that added token exchange.
 * ADR 0025 is that change, so the error is deleted rather than deprecated —
 * the condition it stood on is gone, and a refusal nobody can trigger is worse
 * than no refusal at all.
 */

// ---------------------------------------------------------------------------
// The organization's own identity and ownership (Sprint 10.5, ADR 0024).
//
// Every one of these answers somebody who is already a member of the
// organization they are asking about, so each says why. There is nothing to
// conceal from a person being told what they may not do to their OWN
// organization — and the one thing that would leak, a target in another
// tenant, is not here: it answers with the scoped MembershipNotFoundError
// above, exactly as member administration does.
// ---------------------------------------------------------------------------

/**
 * Raised when the actor's token carries no `organization.update`. In the use
 * case rather than a route decorator, per ADR 0015 rule 1.
 */
export class ForbiddenOrganizationActionError extends OrganizationDomainError {
  constructor() {
    super('you are not allowed to change this organization');
  }
}

/**
 * Raised when somebody who is not the owner tries to hand ownership on.
 *
 * Decided from the STORED membership, never from the token: an access token
 * lives JWT_ACCESS_TTL_SECONDS (900) and nothing compares `mv`, so a former
 * owner's claims outlive their standing by a quarter of an hour — and this is
 * the one operation where spending them would be irreversible from inside the
 * product.
 *
 * It also covers the bootstrap organization, which nobody owns: the holding pen
 * is migration data and a recovery anchor, and a row claiming otherwise would
 * be a provisioning fault rather than a transfer to honour.
 */
export class NotOrganizationOwnerError extends OrganizationDomainError {
  constructor() {
    super("only this organization's owner can transfer ownership");
  }
}

/**
 * Raised when the person named to receive ownership is a member but not one
 * who could exercise it — invited and not yet joined, suspended, or removed.
 *
 * Deliberately blind to WHICH of those it is. The caller holds `people.read`
 * and can see the directory, so this conceals nothing they cannot look up; what
 * it avoids is a second, subtly different vocabulary for membership status
 * living on an endpoint that has no business teaching it.
 */
export class OwnershipTargetNotEligibleError extends OrganizationDomainError {
  constructor() {
    super(
      'ownership can only be transferred to an active member of this organization',
    );
  }
}

/**
 * Raised when the target already owns the organization — which, because only
 * the owner may initiate, is the actor naming themselves.
 *
 * A no-op rather than a success, on the same argument the status transition
 * table makes about self-loops: confirming a change that did not happen leaves
 * the caller's picture of the row stale, and here that picture is "who runs
 * this organization".
 */
export class OwnershipAlreadyHeldError extends OrganizationDomainError {
  constructor() {
    super('that person already owns this organization');
  }
}

/**
 * Raised when the transfer's conditional update found no row to move — the
 * ownership changed between this request being decided and being written.
 *
 * This is what a lost race looks like from the loser's side, and it is a
 * refusal rather than a retry on purpose: the request was authorized against an
 * ownership that no longer exists, so repeating it would be deciding again from
 * the same stale picture.
 */
export class OwnershipTransferConflictError extends OrganizationDomainError {
  constructor() {
    super(
      "this organization's ownership changed while you were deciding; read it again and start over",
    );
  }
}
