import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenOrganizationActionError,
  OrganizationNotFoundError,
} from '../../domain/errors';
import {
  normalizeOrganizationName,
  type Organization,
} from '../../domain/organization';
import type { OrganizationIdentityEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  Clock,
  OrganizationRepository,
} from '../ports/organization.repository';

/**
 * The organization a person is working in, and their standing in it.
 *
 * `ownerUserId` is deliberately NOT here. `organization.read` is in every
 * template, so this answers a requester too, and the id of whoever owns the
 * place is not something a requester needs — while `viewerIsOwner` is exactly
 * what the caller needs to know about themselves. An administrator who does
 * need to see who owns it reads the directory, where the template is already a
 * column.
 */
export interface OrganizationView {
  organization: Organization;
  viewerIsOwner: boolean;
}

/**
 * Reads the organization the caller's token places them in.
 *
 * This is `organization.read`'s first call site. The key has existed since the
 * permission migration and is granted by every template, which was fine while
 * nothing checked it — but a key nothing checks is a claim nothing can
 * falsify, so it is worth saying out loud that this is the first place the
 * platform actually asks for it.
 *
 * The tenant comes from the token and there is no id parameter, which is the
 * rule since Sprint 9.11: an operator holding the database could be trusted to
 * name an organization, a browser cannot.
 */
export class GetOrganizationUseCase {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async execute(actor: Actor): Promise<OrganizationView> {
    if (!hasPermission(actor, PERMISSIONS.ORGANIZATION_READ)) {
      throw new ForbiddenOrganizationActionError();
    }
    const organizationId = requireOrganization(actor);

    const organization = await this.organizations.findById(organizationId);
    if (!organization) {
      // The token names an organization this database has never seen. It is a
      // 404 rather than a 500 for the same reason the internal surface's is:
      // the caller named something that does not exist here.
      throw new OrganizationNotFoundError(organizationId);
    }

    const owner = await this.memberships.findOwner(organizationId);
    return { organization, viewerIsOwner: owner?.userId === actor.id };
  }
}

export interface RenameOrganizationInput {
  name: string;
  correlationId?: string;
}

/**
 * Changes the organization's display name. Nothing else moves.
 *
 * WHY THE SLUG STAYS. It is what the bootstrap lookup keys on, what
 * `prisma migrate deploy` collides with if `bootstrap` is ever taken, and what
 * ADR 0023 derived silently so a collision could never be reported across
 * tenants. Recomputing it from a new name would either reopen that oracle or
 * leave the two disagreeing about which organization a URL means. The branch
 * surface already models this split one level down — `code` is immutable and
 * `name` is not — and the copy on both says so before the choice, not after it.
 *
 * WHY THE TOKEN'S KEY IS ENOUGH HERE. Member administration reads the actor's
 * STORED membership because an access token outlives a demotion by 900 seconds
 * and the act grants authority over somebody else (ADR 0021). A rename grants
 * nothing and is trivially reversible by the next administrator, so it follows
 * the shape every other organization-setup write uses: the permission key from
 * the token, checked in the use case rather than in a route decorator.
 */
export class RenameOrganizationUseCase {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly clock: Clock,
    private readonly events: OrganizationIdentityEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    input: RenameOrganizationInput,
  ): Promise<Organization> {
    if (!hasPermission(actor, PERMISSIONS.ORGANIZATION_UPDATE)) {
      throw new ForbiddenOrganizationActionError();
    }
    const organizationId = requireOrganization(actor);

    // The same normaliser creation uses. Two paths writing this column had to
    // agree about what a name IS, or "Ferretería  Sur" and "Ferretería Sur"
    // would be two spellings of one organization depending on which path
    // wrote it last.
    const name = normalizeOrganizationName(input.name);

    const current = await this.organizations.findById(organizationId);
    if (!current) {
      throw new OrganizationNotFoundError(organizationId);
    }

    // Saving the name it already has is a no-op, NOT a refusal — and this is
    // where it differs from SameRoleTemplateError, which exists because a role
    // write bumps the membership version and invalidates every outstanding
    // token over a non-change. Nothing here is versioned and nothing goes
    // stale, so there is no stale picture to force the caller to re-read;
    // refusing would only be friction, and writing would put a rename that
    // renamed nothing into the audit trail forever.
    if (current.name === name) {
      return current;
    }

    const renamed = await this.organizations.rename(
      organizationId,
      name,
      this.clock.now(),
    );
    if (!renamed) {
      // Deleted between the read and the write. Organizations are never
      // deleted by the product, so this is the same shape of "it vanished
      // underneath me" every other conditional write reports.
      throw new OrganizationNotFoundError(organizationId);
    }

    await this.events.organizationRenamed(
      renamed,
      current.name,
      actor.id,
      input.correlationId,
    );
    return renamed;
  }
}
