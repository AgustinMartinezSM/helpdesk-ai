import {
  roleTemplateFromGlobalRoles,
  type Membership,
} from '../../domain/membership';
import { BOOTSTRAP_ORGANIZATION_SLUG } from '../../domain/organization';
import { OrganizationNotFoundError } from '../../domain/errors';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  Clock,
  IdGenerator,
  OrganizationRepository,
} from '../ports/organization.repository';

export interface EnsureMembershipInput {
  userId: string;
  /** The global roles auth-service stated in the event. */
  roles: string[];
}

/**
 * Gives a newly registered user a membership in the bootstrap organization.
 *
 * Idempotent by construction: an existing membership is returned as it is,
 * never rewritten. That matters more here than in the other consumers in the
 * platform, because a membership is not a projection — overwriting one with
 * event data would silently undo a role change someone made deliberately.
 *
 * This only covers users who register from now on. Users who already existed
 * when the service was created need the operational backfill documented in
 * docs/architecture/data-ownership.md, which applies the same rules; nothing
 * here can enumerate them, because auth-service owns that list and exposes no
 * endpoint for it (ADR 0003).
 */
export class EnsureMembershipUseCase {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: EnsureMembershipInput): Promise<Membership> {
    const organization = await this.organizations.findBySlug(
      BOOTSTRAP_ORGANIZATION_SLUG,
    );
    if (!organization) {
      // The initial migration creates it, so this is a provisioning fault.
      // Throwing rejects the delivery to the DLQ rather than dropping a user
      // on the floor with no record that it happened.
      throw new OrganizationNotFoundError(BOOTSTRAP_ORGANIZATION_SLUG);
    }

    const now = this.clock.now();
    return this.memberships.createIfAbsent({
      id: this.ids.next(),
      organizationId: organization.id,
      userId: input.userId,
      roleTemplate: roleTemplateFromGlobalRoles(input.roles),
      // Self-registration, so there is nothing to accept. The invited state
      // belongs to the invitation flow, which is a later phase.
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}
