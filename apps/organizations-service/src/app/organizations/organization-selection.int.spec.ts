/**
 * Choosing an organization, against a REAL PostgreSQL database (Sprint 10.6,
 * ADR 0025).
 *
 * The unit suite covers the rules with fakes and the controller suite covers
 * the HTTP contract. What only a real database can show is the part they take
 * on trust: that a person can genuinely hold two memberships and that the
 * requested-organization path reads the RIGHT one — including its permissions,
 * its version, its branches and its teams, which are four separate queries
 * that could each pick up the wrong row.
 *
 * It also proves the tenant-isolation claim against real scoped SQL rather
 * than a fake's filter: a membership belonging to somebody else is not
 * reachable by naming its organization.
 */
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaMembershipRepository } from '../../infrastructure/prisma/prisma-membership.repository';
import { PrismaOrganizationRepository } from '../../infrastructure/prisma/prisma-organization.repository';
import { PrismaBranchMembershipRepository } from '../../infrastructure/prisma/prisma-branch-membership.repository';
import { PrismaSupportTeamRepository } from '../../infrastructure/prisma/prisma-support-team.repository';
import { ResolveActiveMembershipUseCase } from '../../application/use-cases/resolve-active-membership';
import { ListMyOrganizationsUseCase } from '../../application/use-cases/list-my-organizations';
import { permissionsForTemplate } from '../../domain/permissions';
import { BOOTSTRAP_ORGANIZATION_SLUG } from '../../domain/organization';
import type { MembershipStatus } from '../../domain/membership';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL must be set. Run via `nx run @helpdesk-ai/organizations-service:test-integration` with the compose stack up.',
  );
}

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';

describe('choosing an organization (real PostgreSQL)', () => {
  let prisma: PrismaService;
  let resolve: ResolveActiveMembershipUseCase;
  let list: ListMyOrganizationsUseCase;

  const createdOrganizations: string[] = [];
  const createdUsers: string[] = [];

  beforeAll(() => {
    prisma = new PrismaService(databaseUrl as string);
    const memberships = new PrismaMembershipRepository(prisma);
    const organizations = new PrismaOrganizationRepository(prisma);
    resolve = new ResolveActiveMembershipUseCase(
      memberships,
      organizations,
      new PrismaBranchMembershipRepository(prisma),
      new PrismaSupportTeamRepository(prisma),
    );
    list = new ListMyOrganizationsUseCase(memberships, organizations);
  });

  afterAll(async () => {
    // Scoped teardown (R9): only what this suite created, memberships before
    // organizations even though the FK cascades.
    if (createdUsers.length) {
      await prisma.membership.deleteMany({
        where: { userId: { in: createdUsers } },
      });
    }
    if (createdOrganizations.length) {
      await prisma.organization.deleteMany({
        where: { id: { in: createdOrganizations } },
      });
    }
    await prisma.$disconnect();
  });

  async function newOrganization(name: string): Promise<string> {
    const id = randomUUID();
    createdOrganizations.push(id);
    const now = new Date();
    await prisma.organization.create({
      data: {
        id,
        // Suffixed so a run that died before teardown cannot collide.
        slug: `${name}-${id.slice(0, 8)}`,
        name,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }

  async function join(
    organizationId: string,
    userId: string,
    roleTemplate: string,
    options: { status?: MembershipStatus; createdAt?: Date } = {},
  ): Promise<string> {
    const id = randomUUID();
    const now = options.createdAt ?? new Date();
    await prisma.membership.create({
      data: {
        id,
        organizationId,
        userId,
        roleTemplate,
        status: options.status ?? 'active',
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }

  function newUser(): string {
    const id = randomUUID();
    createdUsers.push(id);
    return id;
  }

  /** Registration's holding-pen row, which every real account has. */
  async function inBootstrap(userId: string): Promise<void> {
    await join(BOOTSTRAP_ID, userId, 'requester', {
      createdAt: new Date(Date.now() - 60_000),
    });
  }

  it('honours a requested organization, ahead of the default rule', async () => {
    const userId = newUser();
    await inBootstrap(userId);
    const acme = await newOrganization('acme');
    const other = await newOrganization('other');
    await join(acme, userId, 'organization_admin');
    await join(other, userId, 'agent');

    // The default rule returns the OLDEST real one.
    expect((await resolve.execute(userId))?.organizationId).toBe(acme);
    // Asking wins over it — otherwise choosing would do nothing.
    expect((await resolve.execute(userId, other))?.organizationId).toBe(other);
  });

  it('reads permissions, version, branches and teams from the REQUESTED row', async () => {
    /**
     * Four separate queries, each of which could pick up the wrong row. The
     * claims have to describe one membership: a token whose organization is
     * one tenant and whose team scope is another's would pass every check
     * downstream, because the guard validates a signature and nothing
     * compares `mv`.
     */
    const userId = newUser();
    await inBootstrap(userId);
    const acme = await newOrganization('acme');
    const other = await newOrganization('other');
    await join(acme, userId, 'organization_admin');
    const membershipInOther = await join(other, userId, 'agent');

    // Scope that exists ONLY in the second organization.
    const branchId = randomUUID();
    await prisma.branch.create({
      data: {
        id: branchId,
        organizationId: other,
        code: `store-${branchId.slice(0, 6)}`,
        name: 'Store',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.branchMembership.create({
      data: {
        membershipId: membershipInOther,
        branchId,
        createdAt: new Date(),
      },
    });
    const teamId = randomUUID();
    await prisma.supportTeam.create({
      data: {
        id: teamId,
        organizationId: other,
        code: `it-${teamId.slice(0, 6)}`,
        name: 'IT',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.supportTeamMembership.create({
      data: { teamId, membershipId: membershipInOther, createdAt: new Date() },
    });

    const resolved = await resolve.execute(userId, other);

    expect(resolved?.organizationId).toBe(other);
    expect(resolved?.permissions.sort()).toEqual(
      [...permissionsForTemplate('agent')].sort(),
    );
    expect(resolved?.branchIds).toEqual([branchId]);
    expect(resolved?.teamIds).toEqual([teamId]);

    // And the OTHER organization's resolution carries none of it.
    const inAcme = await resolve.execute(userId, acme);
    expect(inAcme?.branchIds).toEqual([]);
    expect(inAcme?.teamIds).toEqual([]);
  });

  it('cannot reach an organization somebody ELSE belongs to', async () => {
    // Tenant isolation against the real scoped query rather than a fake's
    // filter: the lookup is by (organizationId, userId), so a genuine
    // membership held by another person is simply not there.
    const mine = newUser();
    const stranger = newUser();
    await inBootstrap(mine);
    const acme = await newOrganization('acme');
    const theirs = await newOrganization('theirs');
    await join(acme, mine, 'organization_admin');
    await join(theirs, stranger, 'owner');

    expect(await resolve.execute(mine, theirs)).toBeNull();
    // Indistinguishable from an organization that does not exist at all.
    expect(await resolve.execute(mine, randomUUID())).toBeNull();
  });

  it.each(['suspended', 'deactivated', 'invited'] as const)(
    'refuses a %s membership even when asked for by name',
    async (status: MembershipStatus) => {
      const userId = newUser();
      await inBootstrap(userId);
      const other = await newOrganization('other');
      await join(other, userId, 'agent', { status });

      expect(await resolve.execute(userId, other)).toBeNull();
    },
  );

  it('refuses a suspended organization even when asked for by name', async () => {
    const userId = newUser();
    await inBootstrap(userId);
    const suspended = await newOrganization('suspended');
    await prisma.organization.update({
      where: { id: suspended },
      data: { status: 'suspended' },
    });
    await join(suspended, userId, 'organization_admin');

    expect(await resolve.execute(userId, suspended)).toBeNull();
  });

  it('keeps the 9.8 tiebreak when nothing is requested', async () => {
    // The rule that runs on every login, forever. Deleting it would put every
    // invited account back in the migration's holding pen.
    const userId = newUser();
    await inBootstrap(userId);
    const acme = await newOrganization('acme');
    await join(acme, userId, 'agent');

    expect((await resolve.execute(userId))?.organizationId).toBe(acme);
  });

  it('lists both organizations, and never the holding pen', async () => {
    const userId = newUser();
    await inBootstrap(userId);
    const acme = await newOrganization('acme');
    const other = await newOrganization('other');
    await join(acme, userId, 'organization_admin', {
      createdAt: new Date(Date.now() - 30_000),
    });
    await join(other, userId, 'agent');

    const selectable = await list.execute({
      id: userId,
      permissions: new Set<string>(),
    });

    expect(selectable.map((entry) => entry.organizationId)).toEqual([
      acme,
      other,
    ]);
    expect(
      selectable.some((entry) => entry.slug === BOOTSTRAP_ORGANIZATION_SLUG),
    ).toBe(false);
    expect(selectable[1].roleTemplate).toBe('agent');
  });

  it('lists nothing for an account that is only in the holding pen', async () => {
    // The truth: nothing to choose between. Their session still resolves to
    // bootstrap through the default rule, which is why the exclusion is a
    // LISTING rule and never a resolution one.
    const userId = newUser();
    await inBootstrap(userId);

    expect(
      await list.execute({ id: userId, permissions: new Set<string>() }),
    ).toEqual([]);
    expect((await resolve.execute(userId))?.organizationId).toBe(BOOTSTRAP_ID);
  });
});
