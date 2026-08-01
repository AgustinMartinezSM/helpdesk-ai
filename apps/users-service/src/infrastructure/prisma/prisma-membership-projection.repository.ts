import { LOST_CREATED_ROLE_TEMPLATE } from '../../domain/directory-membership';
import type {
  ApplyMembershipCreated,
  ApplyMembershipRoleChanged,
  ApplyMembershipStatusChanged,
  MembershipProjectionRepository,
} from '../../application/ports/membership-projection.repository';
import { PrismaService } from './prisma.service';

/**
 * Single-statement upserts with the LWW guard evaluated INSIDE Postgres,
 * mirroring analytics-service's snapshot repository: two events for the same
 * edge applied concurrently cannot both read a stale updated_at (the row
 * lock serializes the DO UPDATE), and a replayed stale event can never
 * regress a newer status. Ties (identical timestamps) resolve to the later
 * arrival on purpose: with the per-queue serialized consumer that is
 * publication order.
 */
export class PrismaMembershipProjectionRepository implements MembershipProjectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async applyCreated(input: ApplyMembershipCreated): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO directory_memberships
        (organization_id, user_id, role_template, status, updated_at)
      VALUES
        (${input.organizationId}::uuid, ${input.userId}::uuid,
         ${input.roleTemplate}, ${input.status}, ${input.occurredAt})
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        role_template = CASE
          WHEN directory_memberships.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.role_template
          ELSE directory_memberships.role_template END,
        status = CASE
          WHEN directory_memberships.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.status ELSE directory_memberships.status END,
        updated_at = GREATEST(directory_memberships.updated_at, EXCLUDED.updated_at)
    `;
  }

  async applyStatusChanged(input: ApplyMembershipStatusChanged): Promise<void> {
    // The insert arm only fires when the created event was lost: the row is
    // shaped from what this event knows, with the least-privileged role
    // template standing in until the operator script reconciles the truth
    // (see the port contract). status-changed never carries a role template,
    // so the update arm leaves role_template alone.
    await this.prisma.$executeRaw`
      INSERT INTO directory_memberships
        (organization_id, user_id, role_template, status, updated_at)
      VALUES
        (${input.organizationId}::uuid, ${input.userId}::uuid,
         ${LOST_CREATED_ROLE_TEMPLATE}, ${input.toStatus}, ${input.occurredAt})
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        status = CASE
          WHEN directory_memberships.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.status ELSE directory_memberships.status END,
        updated_at = GREATEST(directory_memberships.updated_at, EXCLUDED.updated_at)
    `;
  }

  async applyRoleChanged(input: ApplyMembershipRoleChanged): Promise<boolean> {
    // A plain UPDATE, deliberately without applyStatusChanged's insert arm:
    // that placeholder may invent a role because it errs downward on
    // privilege while pinning the safety-relevant fact the event carries
    // (the status). A role-changed event carries no status, so a row shaped
    // from it would be a guess in both directions, and the operator script
    // (backfill-directory-memberships.sh) is the documented reconciliation
    // (see the port contract). Zero affected rows IS that missing-row skip;
    // the consumer warns on it.
    const affected = await this.prisma.$executeRaw`
      UPDATE directory_memberships SET
        role_template = CASE
          WHEN directory_memberships.updated_at <= ${input.occurredAt}
          THEN ${input.toTemplate}
          ELSE directory_memberships.role_template END,
        updated_at = GREATEST(directory_memberships.updated_at, ${input.occurredAt})
      WHERE organization_id = ${input.organizationId}::uuid
        AND user_id = ${input.userId}::uuid
    `;
    return affected > 0;
  }
}
