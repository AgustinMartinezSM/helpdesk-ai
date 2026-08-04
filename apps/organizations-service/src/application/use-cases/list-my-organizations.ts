import type { Actor } from '@helpdesk-ai/security';
import { grantsAccess, type RoleTemplate } from '../../domain/membership';
import {
  BOOTSTRAP_ORGANIZATION_SLUG,
  isActive,
} from '../../domain/organization';
import type { MembershipRepository } from '../ports/membership.repository';
import type { OrganizationRepository } from '../ports/organization.repository';

export interface SelectableOrganization {
  organizationId: string;
  slug: string;
  name: string;
  /** What the caller is in that organization. Display data, not a decision. */
  roleTemplate: RoleTemplate;
}

/**
 * The organizations this person can act in — the list a switcher offers
 * (Sprint 10.6, ADR 0025).
 *
 * NO PERMISSION KEY, and TENANTLESS. Both are deliberate and both follow
 * `GET /organizations/teams/mine`: the key would have to be one every template
 * holds, which is not a key, and requiring a tenant would make the endpoint
 * unusable in exactly the state it exists to help with — somebody who belongs
 * nowhere, or whose current organization is the one they are trying to leave.
 * Being the authenticated caller is the authorization, the argument
 * `PATCH /users/me` and `POST /organizations` already rest on.
 *
 * IT IS NOT A DIRECTORY OF ORGANIZATIONS. It answers only rows this person
 * holds, and it is the first read in the platform that is deliberately not
 * scoped to one tenant — so the scoping is the caller's own membership set
 * instead. ADR 0023 spent a decision closing a cross-tenant existence oracle
 * for names and slugs; nothing here reopens it, because every name returned is
 * one the caller could already read from the organization they belong to.
 *
 * THE BOOTSTRAP ORGANIZATION IS EXCLUDED. It is migration data and a recovery
 * anchor, not a workspace anybody chooses, and offering it in a picker would
 * invite people into the holding pen. Somebody whose only membership is the
 * bootstrap one gets an empty list, which is the truth: they have nothing to
 * choose between. Their session still resolves there through the default rule,
 * so nothing about them breaks — this is a LISTING rule and never a resolution
 * rule, and implementing it by filtering the resolver would lock those accounts
 * out of the product entirely.
 */
export class ListMyOrganizationsUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationRepository,
  ) {}

  async execute(actor: Actor): Promise<SelectableOrganization[]> {
    const held = await this.memberships.listByUser(actor.id);

    const selectable: SelectableOrganization[] = [];
    for (const membership of held) {
      if (!grantsAccess(membership)) {
        continue;
      }
      const organization = await this.organizations.findById(
        membership.organizationId,
      );
      // The same two gates resolution applies. A list that offered what the
      // mint would then refuse is the picker problem Sprint 9.14 fixed for
      // role templates, one level up.
      if (
        !organization ||
        !isActive(organization) ||
        organization.slug === BOOTSTRAP_ORGANIZATION_SLUG
      ) {
        continue;
      }
      selectable.push({
        organizationId: organization.id,
        slug: organization.slug,
        name: organization.name,
        roleTemplate: membership.roleTemplate,
      });
    }

    // Oldest first, matching the order the default rule walks: the first entry
    // is the one a fresh sign-in lands in, so the list reads the same way the
    // product behaves.
    return selectable;
  }
}
