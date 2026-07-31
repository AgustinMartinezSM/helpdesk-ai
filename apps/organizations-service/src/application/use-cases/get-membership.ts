import type { MembershipStatus, RoleTemplate } from '../../domain/membership';
import { MembershipNotFoundError } from '../../domain/errors';
import { permissionsForTemplate } from '../../domain/permissions';
import type { OrganizationStatus } from '../../domain/organization';
import type { MembershipRepository } from '../ports/membership.repository';
import type { OrganizationRepository } from '../ports/organization.repository';

export interface MembershipView {
  organizationId: string;
  userId: string;
  status: MembershipStatus;
  roleTemplate: RoleTemplate;
  permissions: string[];
  membershipVersion: number;
  organizationStatus: OrganizationStatus;
}

/**
 * Answers "what is this person's standing in this organization" for another
 * service — the verification tickets-service runs before assigning a ticket
 * to someone.
 *
 * Permissions are resolved from the template regardless of status, on
 * purpose: the CALLER decides what a non-active membership means for the
 * operation it is guarding. Hiding them here would collapse "suspended
 * agent" into "not a member", which is exactly the distinction this view
 * exists to expose — status and permissions travel together so the caller
 * can weigh both.
 *
 * Not found is an error, unlike the mint-time resolution which answers
 * nulls: a caller of this endpoint named a specific membership, so absence
 * is a definite answer about that pair, not an expected migration state.
 */
export class GetMembershipUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationRepository,
  ) {}

  async execute(
    organizationId: string,
    userId: string,
  ): Promise<MembershipView> {
    const membership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      userId,
    );
    if (!membership) {
      throw new MembershipNotFoundError(organizationId, userId);
    }

    const organization = await this.organizations.findById(
      membership.organizationId,
    );
    if (!organization) {
      // The membership row has a real foreign key to its organization
      // (ADR 0013), so this cannot happen without a broken database.
      throw new Error(
        `organization ${membership.organizationId} is missing for membership ${membership.id}`,
      );
    }

    return {
      organizationId: membership.organizationId,
      userId: membership.userId,
      status: membership.status,
      roleTemplate: membership.roleTemplate,
      permissions: [...permissionsForTemplate(membership.roleTemplate)],
      membershipVersion: membership.version,
      organizationStatus: organization.status,
    };
  }
}
