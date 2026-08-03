import { requireOrganization, type Actor } from '@helpdesk-ai/security';
import {
  MembershipNotFoundError,
  NotOrganizationOwnerError,
  OrganizationNotFoundError,
  OwnershipAlreadyHeldError,
  OwnershipTargetNotEligibleError,
  OwnershipTransferConflictError,
} from '../../domain/errors';
import {
  grantsAccess,
  OWNER_ROLE_TEMPLATE,
  type Membership,
} from '../../domain/membership';
import { BOOTSTRAP_ORGANIZATION_SLUG } from '../../domain/organization';
import type {
  MembershipEventPublisher,
  OrganizationIdentityEventPublisher,
} from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  Clock,
  OrganizationRepository,
} from '../ports/organization.repository';

export interface TransferOrganizationOwnershipInput {
  /** The person receiving it. The organization comes from the actor's token. */
  userId: string;
  correlationId?: string;
}

export interface OwnershipTransferred {
  previousOwner: Membership;
  newOwner: Membership;
}

/**
 * Hands an organization to one of its members, in one write.
 *
 * WHY THIS IS NOT A GRANT, AND MUST NOT BECOME ONE. `owner` is excluded from
 * `ORGANIZATION_GRANTABLE_TEMPLATES` by constant so that no grant path can
 * produce one, and ADR 0023 kept creation outside that derivation for the same
 * reason. A grant hands a template OUT of the grantable set to somebody while
 * the granter keeps what they had; this moves a single `owner` between two rows
 * of one organization and leaves the count where it was. Routing it through
 * `canGrantRoleTemplate` would mean widening the set to make it fit, which is
 * the one thing that would turn ADR 0015's invariant back into an accident.
 *
 * WHY THIS DOES NOT BREACH "NOBODY ADMINISTERS THEIR OWN MEMBERSHIP"
 * (ADR 0021). That rule exists to keep an organization from losing its last
 * administrator: the actor must hold the key and be active to act at all, and
 * can never be the target, so at least one privileged member survives any
 * sequence of those operations. This changes the actor's own row — it demotes
 * them — and the invariant still holds, by construction rather than by
 * exception: the transfer writes exactly one `owner` and one
 * `organization_admin`, so the organization ends with strictly more privileged
 * members than it started with, never fewer. The rule's failure mode is
 * unreachable here.
 *
 * WHY THE ACTOR'S TEMPLATE IS READ FROM THE ROW AND NOT FROM THE TOKEN. An
 * access token lives JWT_ACCESS_TTL_SECONDS (900 by default) and nothing
 * compares `mv`, so a person who handed ownership away a minute ago still
 * carries a token that says owner. Every other consequence of that staleness is
 * a fifteen-minute annoyance; this one would let them take the organization
 * back from the person they just gave it to.
 *
 * WHY THERE IS NO PERMISSION KEY. The approved matrix has no
 * `organization.transfer_ownership` row, `owner` and `organization_admin`
 * resolve to the same permission set today, and the check above has to read the
 * row regardless — so a key would be a second, weaker copy of a fact the row
 * already states. The browser gets `viewerIsOwner` from
 * `GetOrganizationUseCase` instead, which is read fresh rather than snapshotted
 * into a token (ADR 0020's rule is that the browser decides what to RENDER from
 * a server-supplied signal; it does not require that signal to be a permission).
 */
export class TransferOrganizationOwnershipUseCase {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly events: MembershipEventPublisher &
      OrganizationIdentityEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    input: TransferOrganizationOwnershipInput,
  ): Promise<OwnershipTransferred> {
    const organizationId = requireOrganization(actor);

    const organization = await this.organizations.findById(organizationId);
    if (!organization) {
      throw new OrganizationNotFoundError(organizationId);
    }
    if (organization.slug === BOOTSTRAP_ORGANIZATION_SLUG) {
      // The holding pen is migration data and a recovery anchor: it is seeded
      // with no owner, and every account that has ever registered is in it.
      // If a row ever claimed to own it, that is a provisioning fault to
      // investigate rather than an ownership to hand on.
      throw new NotOrganizationOwnerError();
    }

    const actorMembership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      actor.id,
    );
    if (!actorMembership || !grantsAccess(actorMembership)) {
      // The token says they belong; the row says otherwise, or says suspended.
      // The row wins — the same refusal every administration path gives.
      throw new MembershipNotFoundError(organizationId, actor.id);
    }
    if (actorMembership.roleTemplate !== OWNER_ROLE_TEMPLATE) {
      throw new NotOrganizationOwnerError();
    }

    // Only the owner reaches this line, so naming yourself is naming the
    // current owner. Checked before the target lookup so the message is about
    // the state of the organization rather than about a row.
    if (input.userId === actor.id) {
      throw new OwnershipAlreadyHeldError();
    }

    const target = await this.memberships.findByOrganizationAndUser(
      organizationId,
      input.userId,
    );
    if (!target) {
      // Scoped by construction: a member of another organization and a user id
      // that never existed answer alike, so this cannot be used to discover
      // who belongs where. It is the same 404 member administration gives.
      throw new MembershipNotFoundError(organizationId, input.userId);
    }
    if (target.roleTemplate === OWNER_ROLE_TEMPLATE) {
      // Unreachable while the partial unique index holds — there is only one
      // owner row and it is the actor's. Kept because the alternative is a
      // check that exists only in the database, and this one names the reason.
      throw new OwnershipAlreadyHeldError();
    }
    if (!grantsAccess(target)) {
      // invited, suspended or deactivated. An invitation that nobody has
      // redeemed has no membership row at all, so it lands on the 404 above;
      // this covers the person who was invited into a row and has not joined,
      // and the colleague somebody suspended this morning.
      throw new OwnershipTargetNotEligibleError();
    }

    const transferred = await this.memberships.transferOwnership({
      organizationId,
      fromMembershipId: actorMembership.id,
      toMembershipId: target.id,
      at: this.clock.now(),
    });
    if (!transferred) {
      // Somebody moved the ownership between this request being decided and
      // being written. Every check above was made against a state that no
      // longer exists, so the caller re-reads rather than retries.
      throw new OwnershipTransferConflictError();
    }

    // Both rows publish their own role change, because that is what keeps
    // users-service's directory projection right — a People screen still
    // showing the previous owner as owner would be the visible half of this
    // going wrong. Neither of them says who decided it, which is what the
    // third event is for.
    await this.events.membershipRoleChanged(
      transferred.previousOwner,
      OWNER_ROLE_TEMPLATE,
      input.correlationId,
    );
    await this.events.membershipRoleChanged(
      transferred.newOwner,
      target.roleTemplate,
      input.correlationId,
    );
    await this.events.organizationOwnershipTransferred(
      {
        organizationId,
        transferredByUserId: actor.id,
        previousOwnerUserId: transferred.previousOwner.userId,
        newOwnerUserId: transferred.newOwner.userId,
        newOwnerPreviousRoleTemplate: target.roleTemplate,
        at: transferred.newOwner.updatedAt,
      },
      input.correlationId,
    );

    return transferred;
  }
}
