/**
 * Bulk import against the real database (Sprint 9.15).
 *
 * The in-memory suite covers every decision the import makes. This one covers
 * the two the DATABASE owns and no fake can prove: the partial unique index
 * that makes a re-run idempotent without a prior read, and the foreign keys
 * that carry a placement from the invitation onto the membership inside a
 * single transaction.
 *
 * Two organizations with a branch of the SAME NAME, because the only thing
 * that can tell them apart is the organization scope on the lookup — which is
 * exactly the property a tenant-isolation test should not be able to pass by
 * accident.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/organizations-service:test-integration`.
 */
import { randomUUID } from 'node:crypto';
import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { OrganizationEventPublisher } from '../../application/ports/event-publisher';
import { SystemClock } from '../../application/ports/organization.repository';
import { AcceptInvitationUseCase } from '../../application/use-cases/accept-invitation';
import { ImportPeopleUseCase } from '../../application/use-cases/import-people';
import { PrismaBranchRepository } from '../../infrastructure/prisma/prisma-branch.repository';
import { PrismaDepartmentRepository } from '../../infrastructure/prisma/prisma-department.repository';
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

/** Events are covered by the contract specs; this suite needs them silent. */
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
  peopleImportCompleted: async () => undefined,
} as unknown as OrganizationEventPublisher;

describe('people import (real database, two organizations)', () => {
  let prisma: PrismaService;
  let orgA: OrganizationFixture;
  let orgB: OrganizationFixture;
  let admin: Actor;
  let importPeople: ImportPeopleUseCase;
  let accept: AcceptInvitationUseCase;
  let storeTwelve: string;
  let electronics: string;
  let rivalStoreTwelve: string;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    orgA = await createOrganizationFixture(prisma, 'import-a');
    orgB = await createOrganizationFixture(prisma, 'import-b');

    const memberships = new PrismaMembershipRepository(prisma);
    const invitations = new PrismaInvitationRepository(prisma);
    const clock = new SystemClock();
    const ids = new UuidGenerator();

    admin = {
      id: randomUUID(),
      organizationId: orgA.organizationId,
      permissions: new Set<string>([
        PERMISSIONS.ORGANIZATION_READ,
        PERMISSIONS.PEOPLE_IMPORT,
      ]),
    };
    await memberships.createIfAbsent({
      id: randomUUID(),
      organizationId: orgA.organizationId,
      userId: admin.id,
      roleTemplate: 'organization_admin',
      status: 'active',
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    storeTwelve = randomUUID();
    rivalStoreTwelve = randomUUID();
    electronics = randomUUID();
    await prisma.branch.createMany({
      data: [
        {
          id: storeTwelve,
          organizationId: orgA.organizationId,
          code: 'store-12',
          name: 'Store 12',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: rivalStoreTwelve,
          organizationId: orgB.organizationId,
          code: 'store-12',
          name: 'Store 12',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await prisma.department.create({
      data: {
        id: electronics,
        branchId: storeTwelve,
        name: 'Electronics',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    });

    importPeople = new ImportPeopleUseCase(
      invitations,
      memberships,
      new PrismaBranchRepository(prisma),
      new PrismaDepartmentRepository(prisma),
      clock,
      ids,
      silentEvents,
    );
    accept = new AcceptInvitationUseCase(
      invitations,
      memberships,
      new PrismaOrganizationRepository(prisma),
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
    return `import-${randomUUID().slice(0, 12)}@example.com`;
  }

  it('is idempotent because the index says so, not because it read first', async () => {
    const email = address();
    const csv = `email,role\n${email},agent\n`;

    const first = await importPeople.execute(admin, { csv, dryRun: false });
    expect(first.summary.invited).toBe(1);

    const second = await importPeople.execute(admin, { csv, dryRun: false });

    // The partial unique index (WHERE status = 'pending') is the arbiter. A
    // pre-read alone would race two administrators importing overlapping
    // files; this cannot, because the loser fails the write.
    expect(second.summary).toEqual(
      expect.objectContaining({ invited: 0, alreadyInvited: 1, failed: 0 }),
    );
    expect(
      await prisma.invitation.count({
        where: { organizationId: orgA.organizationId, inviteeEmail: email },
      }),
    ).toBe(1);
  });

  it('carries the placement onto the membership in ONE transaction', async () => {
    const email = address();
    const result = await importPeople.execute(admin, {
      csv: `email,role,branch,department\n${email},agent,Store 12,Electronics\n`,
      dryRun: false,
    });
    const outcome = result.rows[0].outcome;
    if (outcome.status !== 'invited') {
      throw new Error(`expected an invitation, got ${outcome.status}`);
    }

    const stored = await prisma.invitation.findFirst({
      where: { organizationId: orgA.organizationId, inviteeEmail: email },
    });
    expect(stored?.branchId).toBe(storeTwelve);
    expect(stored?.departmentId).toBe(electronics);

    const redeemer = randomUUID();
    await accept.execute(
      { id: redeemer, permissions: new Set() },
      { code: outcome.code, actorEmail: email },
    );

    const membership = await prisma.membership.findFirst({
      where: { organizationId: orgA.organizationId, userId: redeemer },
    });
    expect(membership).not.toBeNull();
    // The membership and both edges, written together. A second write outside
    // the transaction is exactly the split this table lives here to avoid
    // (ADR 0019) — it would leave a member placed nowhere and nothing to retry.
    expect(
      (
        await prisma.branchMembership.findMany({
          where: { membershipId: membership?.id },
        })
      ).map((edge) => edge.branchId),
    ).toEqual([storeTwelve]);
    expect(
      (
        await prisma.departmentMembership.findMany({
          where: { membershipId: membership?.id },
        })
      ).map((edge) => edge.departmentId),
    ).toEqual([electronics]);
  });

  it('invents no placement for an invitation that carries none', async () => {
    const email = address();
    const result = await importPeople.execute(admin, {
      csv: `email,role\n${email},requester\n`,
      dryRun: false,
    });
    const outcome = result.rows[0].outcome;
    if (outcome.status !== 'invited') {
      throw new Error('expected an invitation');
    }

    const redeemer = randomUUID();
    await accept.execute(
      { id: redeemer, permissions: new Set() },
      { code: outcome.code, actorEmail: email },
    );

    const membership = await prisma.membership.findFirst({
      where: { organizationId: orgA.organizationId, userId: redeemer },
    });
    // Null placement is what the single-invitation form produces, forever.
    expect(
      await prisma.branchMembership.count({
        where: { membershipId: membership?.id },
      }),
    ).toBe(0);
  });

  it("never resolves the other organization's branch of the same name", async () => {
    const email = address();

    const result = await importPeople.execute(admin, {
      csv: `email,branch\n${email},Store 12\n`,
      dryRun: false,
    });
    expect(result.summary.invited).toBe(1);

    const stored = await prisma.invitation.findFirst({
      where: { organizationId: orgA.organizationId, inviteeEmail: email },
    });
    expect(stored?.branchId).toBe(storeTwelve);
    expect(stored?.branchId).not.toBe(rivalStoreTwelve);
  });

  it('writes nothing at all on a dry run', async () => {
    const email = address();
    const before = await prisma.invitation.count({
      where: { organizationId: orgA.organizationId },
    });

    const preview = await importPeople.execute(admin, {
      csv: `email,role,branch,department\n${email},agent,Store 12,Electronics\n`,
      dryRun: true,
    });

    expect(preview.summary.dryRun).toBe(true);
    expect(preview.summary.invited).toBe(1);
    expect(
      await prisma.invitation.count({
        where: { organizationId: orgA.organizationId },
      }),
    ).toBe(before);
  });
});
