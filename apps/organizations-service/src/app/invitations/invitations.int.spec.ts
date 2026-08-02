/**
 * Sprint 9.8's key integration, against the real database: the invitation
 * walk end to end, the single-use guarantee under genuine concurrency, and
 * the adversarial matrix across TWO real organizations.
 *
 * Two organizations is what makes this suite different from its neighbours,
 * and it is why the fixture in infrastructure/testing exists: an unfiltered
 * `deleteMany()` teardown (R9) would delete the other tenant's rows out from
 * under the test that needs them.
 *
 * The events are not asserted here — the broker path is covered by the
 * structure suite and the payload shapes by the contract specs. What only a
 * real database can prove is the conditional UPDATE and the partial unique
 * index, so that is what this suite is for.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/organizations-service:test-integration`.
 */
import { randomUUID } from 'node:crypto';
import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import { SystemClock } from '../../application/ports/organization.repository';
import { AcceptInvitationUseCase } from '../../application/use-cases/accept-invitation';
import { IssueInvitationUseCase } from '../../application/use-cases/issue-invitation';
import { ListInvitationsUseCase } from '../../application/use-cases/list-invitations';
import { RevokeInvitationUseCase } from '../../application/use-cases/revoke-invitation';
import {
  DuplicatePendingInvitationError,
  InvitationNotFoundError,
  InvitationNotRedeemableError,
} from '../../domain/errors';
import type { OrganizationEventPublisher } from '../../application/ports/event-publisher';
import { PrismaInvitationRepository } from '../../infrastructure/prisma/prisma-invitation.repository';
import { PrismaMembershipRepository } from '../../infrastructure/prisma/prisma-membership.repository';
import { PrismaOrganizationRepository } from '../../infrastructure/prisma/prisma-organization.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  createOrganizationFixture,
  dropOrganizationFixtures,
  type OrganizationFixture,
} from '../../infrastructure/testing/organization-fixture';
import { UuidGenerator } from '../../infrastructure/uuid-generator';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL must be set. Run via `nx run @helpdesk-ai/organizations-service:test-integration` with the compose stack up.',
  );
}

/** Events are covered elsewhere; this suite only needs them not to throw. */
const silentEvents = {
  membershipCreated: async () => undefined,
  membershipStatusChanged: async () => undefined,
  membershipRoleChanged: async () => undefined,
  branchCreated: async () => undefined,
  branchUpdated: async () => undefined,
  stationCreated: async () => undefined,
  stationUpdated: async () => undefined,
  invitationIssued: async () => undefined,
  invitationAccepted: async () => undefined,
  invitationRevoked: async () => undefined,
} as unknown as OrganizationEventPublisher;

const ADMIN_PERMISSIONS = new Set<string>([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.PEOPLE_READ,
  PERMISSIONS.PEOPLE_INVITE,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
]);

describe('invitations (real database, two organizations)', () => {
  let prisma: PrismaService;
  let orgA: OrganizationFixture;
  let orgB: OrganizationFixture;
  let adminA: Actor;
  let adminB: Actor;
  let issue: IssueInvitationUseCase;
  let list: ListInvitationsUseCase;
  let revoke: RevokeInvitationUseCase;
  let accept: AcceptInvitationUseCase;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    orgA = await createOrganizationFixture(prisma, 'invitations-a');
    orgB = await createOrganizationFixture(prisma, 'invitations-b');

    const organizations = new PrismaOrganizationRepository(prisma);
    const memberships = new PrismaMembershipRepository(prisma);
    const invitations = new PrismaInvitationRepository(prisma);
    const clock = new SystemClock();
    const ids = new UuidGenerator();

    adminA = {
      id: randomUUID(),
      organizationId: orgA.organizationId,
      permissions: ADMIN_PERMISSIONS,
    };
    adminB = {
      id: randomUUID(),
      organizationId: orgB.organizationId,
      permissions: ADMIN_PERMISSIONS,
    };
    for (const [admin, fixture] of [
      [adminA, orgA],
      [adminB, orgB],
    ] as const) {
      await memberships.createIfAbsent({
        id: randomUUID(),
        organizationId: fixture.organizationId,
        userId: admin.id,
        roleTemplate: 'organization_admin',
        status: 'active',
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    issue = new IssueInvitationUseCase(
      invitations,
      memberships,
      clock,
      ids,
      silentEvents,
    );
    list = new ListInvitationsUseCase(invitations, clock);
    revoke = new RevokeInvitationUseCase(invitations, clock, silentEvents);
    accept = new AcceptInvitationUseCase(
      invitations,
      memberships,
      organizations,
      clock,
      ids,
      silentEvents,
    );
  });

  afterAll(async () => {
    await dropOrganizationFixtures(prisma, [orgA, orgB]);
    await prisma.$disconnect();
  });

  function address(): string {
    return `invitee-${randomUUID()}@empresa.com`;
  }

  it('walks issue → accept → membership, org-scoped', async () => {
    const email = address();
    const newcomer = randomUUID();

    const issued = await issue.execute(adminA, {
      inviteeEmail: email,
      roleTemplate: 'agent',
    });
    const accepted = await accept.execute(
      { id: newcomer, permissions: new Set() },
      { code: issued.code, actorEmail: email.toUpperCase() },
    );

    expect(accepted.membershipCreated).toBe(true);
    expect(accepted.membership.organizationId).toBe(orgA.organizationId);

    const row = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: orgA.organizationId,
          userId: newcomer,
        },
      },
    });
    expect(row?.roleTemplate).toBe('agent');
    expect(row?.status).toBe('active');
  });

  it('lets exactly one of two concurrent redemptions win', async () => {
    const email = address();
    const first = randomUUID();
    const second = randomUUID();
    const issued = await issue.execute(adminA, {
      inviteeEmail: email,
      roleTemplate: 'requester',
    });

    // The conditional UPDATE is the whole point: without it both would read
    // 'pending', both would insert, and one invitation would have produced
    // two memberships.
    const results = await Promise.allSettled([
      accept.execute(
        { id: first, permissions: new Set() },
        { code: issued.code, actorEmail: email },
      ),
      accept.execute(
        { id: second, permissions: new Set() },
        { code: issued.code, actorEmail: email },
      ),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      InvitationNotRedeemableError,
    );

    const created = await prisma.membership.count({
      where: {
        organizationId: orgA.organizationId,
        userId: { in: [first, second] },
      },
    });
    expect(created).toBe(1);
  });

  it('refuses a second pending invitation for the same address', async () => {
    const email = address();
    await issue.execute(adminA, {
      inviteeEmail: email,
      roleTemplate: 'agent',
    });

    // The partial unique index decides, not a prior read.
    await expect(
      issue.execute(adminA, { inviteeEmail: email, roleTemplate: 'requester' }),
    ).rejects.toBeInstanceOf(DuplicatePendingInvitationError);
  });

  it('allows the SAME address to be pending in both organizations at once', async () => {
    const email = address();

    await expect(
      issue.execute(adminA, { inviteeEmail: email, roleTemplate: 'agent' }),
    ).resolves.toBeDefined();
    // The index is scoped by organization; a person can be courted by two
    // companies at the same time.
    await expect(
      issue.execute(adminB, { inviteeEmail: email, roleTemplate: 'agent' }),
    ).resolves.toBeDefined();
  });

  it("hides another organization's invitation from listing and revoking", async () => {
    const issued = await issue.execute(adminA, {
      inviteeEmail: address(),
      roleTemplate: 'agent',
    });

    const seenByB = await list.execute(adminB, { limit: 100, offset: 0 });
    expect(
      seenByB.some((invitation) => invitation.id === issued.invitation.id),
    ).toBe(false);

    // Not-found, never forbidden: confirming existence is the leak.
    await expect(
      revoke.execute(adminB, issued.invitation.id),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);

    const untouched = await prisma.invitation.findUnique({
      where: { id: issued.invitation.id },
    });
    expect(untouched?.status).toBe('pending');
  });

  it('answers a wrong secret exactly as it answers an unknown id', async () => {
    const email = address();
    const issued = await issue.execute(adminA, {
      inviteeEmail: email,
      roleTemplate: 'agent',
    });
    const [id, secret] = issued.code.split('.');
    const redeemer = { id: randomUUID(), permissions: new Set<string>() };

    await expect(
      accept.execute(redeemer, {
        code: `${id}.${'z'.repeat(secret.length)}`,
        actorEmail: email,
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(
      accept.execute(redeemer, {
        code: `${randomUUID()}.${secret}`,
        actorEmail: email,
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it('keeps the code out of the row entirely', async () => {
    const issued = await issue.execute(adminA, {
      inviteeEmail: address(),
      roleTemplate: 'agent',
    });
    const secret = issued.code.split('.')[1];

    const row = await prisma.invitation.findUnique({
      where: { id: issued.invitation.id },
    });
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to redeem a revoked invitation', async () => {
    const email = address();
    const issued = await issue.execute(adminA, {
      inviteeEmail: email,
      roleTemplate: 'agent',
    });
    await revoke.execute(adminA, issued.invitation.id);

    await expect(
      accept.execute(
        { id: randomUUID(), permissions: new Set() },
        { code: issued.code, actorEmail: email },
      ),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
  });
});
