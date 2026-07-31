import {
  ROLE_TEMPLATES,
  type Membership,
  type RoleTemplate,
} from '../../domain/membership';
import {
  InvalidRoleTemplateError,
  MembershipNotFoundError,
  SameRoleTemplateError,
} from '../../domain/errors';
import type { MembershipEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock } from '../ports/organization.repository';

export interface ChangeMembershipRoleInput {
  organizationId: string;
  userId: string;
  /** Validated here against ROLE_TEMPLATES, not trusted from the caller. */
  roleTemplate: string;
  correlationId?: string;
}

/**
 * Moves a membership onto another role template and announces the move —
 * the operation the retail scenario needs so a branch manager can exist
 * before the people-management sprint builds the real surface.
 *
 * A target equal to the current template is refused, mirroring the status
 * transition table's no-self-loop argument: an "already there" request
 * means the caller acted on a stale picture of the row, and a success would
 * confirm it — while writing anyway would bump the version and invalidate
 * every outstanding token over a non-change.
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

  async execute(input: ChangeMembershipRoleInput): Promise<Membership> {
    // The DTO already refuses unknown words with a 400; this guards callers
    // that never went through HTTP validation.
    if (!isRoleTemplate(input.roleTemplate)) {
      throw new InvalidRoleTemplateError(input.roleTemplate);
    }

    const membership = await this.memberships.findByOrganizationAndUser(
      input.organizationId,
      input.userId,
    );
    if (!membership) {
      throw new MembershipNotFoundError(input.organizationId, input.userId);
    }

    if (membership.roleTemplate === input.roleTemplate) {
      throw new SameRoleTemplateError(input.roleTemplate);
    }

    const updated = await this.memberships.changeRoleTemplate(
      membership.id,
      input.roleTemplate,
      this.clock.now(),
    );
    await this.events.membershipRoleChanged(
      updated,
      membership.roleTemplate,
      input.correlationId,
    );
    return updated;
  }
}

function isRoleTemplate(value: string): value is RoleTemplate {
  return (ROLE_TEMPLATES as readonly string[]).includes(value);
}
