import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Two real organizations in the real database, plus the teardown that puts
 * them back.
 *
 * This is R9's shared fixture, paid for organizations-service only. The debt
 * is repo-wide — every integration suite still tears down with an unfiltered
 * `deleteMany()`, which in a two-tenant test deletes the other tenant's rows
 * — and the module that fixes it everywhere is still owed. What forced the
 * payment here is the invitations table: it cascades from organizations, so
 * teardown ORDER became load-bearing in this service for the first time.
 *
 * The bootstrap organization is deliberately untouched. It arrives from a
 * migration that `migrate deploy` will not re-run, so a suite that deleted it
 * would leave every later suite on that database broken.
 */
export interface OrganizationFixture {
  organizationId: string;
  slug: string;
}

export async function createOrganizationFixture(
  prisma: PrismaService,
  label: string,
): Promise<OrganizationFixture> {
  const organizationId = randomUUID();
  // Random slug per run: the local database is shared between suites and a
  // fixed slug would collide with a previous run that failed before teardown.
  const slug = `${label}-${organizationId.slice(0, 8)}`;
  const now = new Date();

  await prisma.organization.create({
    data: {
      id: organizationId,
      slug,
      name: `Fixture ${label}`,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  });

  return { organizationId, slug };
}

/**
 * Deletes only what these fixtures own, in dependency order.
 *
 * Invitations and memberships would both cascade from the organization, but
 * they are deleted explicitly first: relying on the cascade would make the
 * teardown silently correct only for as long as the FK stays `ON DELETE
 * CASCADE`, and a future schema change to `RESTRICT` would turn a green suite
 * into an unexplained failure at the last statement.
 */
export async function dropOrganizationFixtures(
  prisma: PrismaService,
  fixtures: OrganizationFixture[],
): Promise<void> {
  const organizationIds = fixtures.map((fixture) => fixture.organizationId);
  if (organizationIds.length === 0) {
    return;
  }
  await prisma.invitation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.membership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: organizationIds } },
  });
}
