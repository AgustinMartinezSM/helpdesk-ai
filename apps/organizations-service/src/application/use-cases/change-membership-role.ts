import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { Membership } from '../../domain/membership';
import {
  InvalidRoleTemplateError,
  RoleTemplateNotGrantableError,
  SameRoleTemplateError,
} from '../../domain/errors';
import {
  canGrantRoleTemplate,
  isGrantableRoleTemplate,
} from '../../domain/role-grants';
import { requireAdministrableTarget } from '../membership-administration';
import type { MembershipEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock } from '../ports/organization.repository';

export interface ChangeMembershipRoleInput {
  /** The person being administered. The organization comes from the actor. */
  userId: string;
  /** Validated here against the grantable templates, not trusted. */
  roleTemplate: string;
  correlationId?: string;
}

/**
 * Moves a membership onto another role template and announces the move.
 *
 * Gated on `people.assign_roles`, and bounded by two ceilings that both read
 * STORED rows (ADR 0021): the requested template must be one the actor could
 * exercise themselves — or this key would be a self-promotion key — and the
 * target's current template must be too, or an administrator could demote
 * anyone at all. `owner` fails both by constant, because the permission map
 * resolves it and organization_admin alike.
 *
 * A target equal to the current template is refused, mirroring the status
 * transition table's no-self-loop argument: an "already there" request means
 * the caller acted on a stale picture of the row, and a success would confirm
 * it — while writing anyway would bump the version and invalidate every
 * outstanding token over a non-change.
 *
 * The event carries the PRE-change template as fromTemplate; publishing is
 * best-effort after the commit (ADR 0006).
 */
export class ChangeMembershipRoleUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly events: MembershipEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    input: ChangeMembershipRoleInput,
  ): Promise<Membership> {
    const { actorMembership, target } = await requireAdministrableTarget(
      actor,
      PERMISSIONS.PEOPLE_ASSIGN_ROLES,
      this.memberships,
      input.userId,
    );

    // The DTO already refuses unknown words and `owner` with a 400; this
    // guards callers that never went through HTTP validation.
    if (!isGrantableRoleTemplate(input.roleTemplate)) {
      throw new InvalidRoleTemplateError(input.roleTemplate);
    }
    if (
      !canGrantRoleTemplate(actorMembership.roleTemplate, input.roleTemplate)
    ) {
      throw new RoleTemplateNotGrantableError(input.roleTemplate);
    }
    if (target.roleTemplate === input.roleTemplate) {
      throw new SameRoleTemplateError(input.roleTemplate);
    }

    const updated = await this.memberships.changeRoleTemplate(
      target.id,
      input.roleTemplate,
      this.clock.now(),
    );
    await this.events.membershipRoleChanged(
      updated,
      target.roleTemplate,
      input.correlationId,
    );
    return updated;
  }
}
