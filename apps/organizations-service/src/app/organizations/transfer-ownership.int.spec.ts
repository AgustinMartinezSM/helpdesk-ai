/**
 * Transferring ownership against a REAL PostgreSQL database.
 *
 * The unit suite covers the rules with fakes and the controller suite covers
 * the HTTP contract. What only a real database can show is everything the
 * others take on trust, and for this operation that is most of the argument:
 *
 * - both rows move in ONE transaction, and a failure leaves neither moved;
 * - the partial unique index actually exists and actually refuses a second
 *   owner — a claim no fake can make on behalf of the schema;
 * - two genuinely concurrent transfers cannot both win, which is a statement
 *   about row locks and cannot be simulated by an array.
 *
 * A fake can be written to agree with any of these. Only the database can
 * disagree.
 */
import { randomUUID } from 'node:crypto';
import type { Actor } from '@helpdesk-ai/security';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaMembershipRepository } from '../../infrastructure/prisma/prisma-membership.repository';
import { PrismaOrganizationRepository } from '../../infrastructure/prisma/prisma-organization.repository';
import { TransferOrganizationOwnershipUseCase } from '../../application/use-cases/transfer-organization-ownership';
import {
  GetOrganizationUseCase,
  RenameOrganizationUseCase,
} from '../../application/use-cases/organization-identity';
import {
  NotOrganizationOwnerError,
  OwnershipTargetNotEligibleError,
  OwnershipTransferConflictError,
} from '../../domain/errors';
import { permissionsForTemplate } from '../../domain/permissions';
import { SystemClock } from '../../application/ports/organization.repository';
import type {
  MembershipEventPublisher,
  OrganizationIdentityEventPublisher,
  OwnershipTransfer,
} from '../../application/ports/event-publisher';
import type { Membership, MembershipStatus } from '../../domain/membership';
import type { Organization } from '../../domain/organization';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL must be set. Run via `nx run @helpdesk-ai/organizations-service:test-integration` with the compose stack up.',
  );
}

describe('transferring ownership (real PostgreSQL)', () => {
  let prisma: PrismaService;
  let memberships: PrismaMembershipRepository;
  let organizations: PrismaOrganizationRepository;
  let transfer: TransferOrganizationOwnershipUseCase;

  const roleChanges: { userId: string; from: string; to: string }[] = [];
  const transfers: OwnershipTransfer[] = [];

  /** Everything this suite made, so teardown removes only its own rows. */
  const createdOrganizations: string[] = [];
  const createdUsers: string[] = [];

  beforeAll(() => {
    prisma = new PrismaService(databaseUrl as string);
    memberships = new PrismaMembershipRepository(prisma);
    organizations = new PrismaOrganizationRepository(prisma);

    const events: MembershipEventPublisher &
      OrganizationIdentityEventPublisher = {
      membershipCreated: async () => undefined,
      membershipStatusChanged: async () => undefined,
      membershipRoleChanged: async (membership, fromTemplate) => {
        roleChanges.push({
          userId: membership.userId,
          from: fromTemplate,
          to: membership.roleTemplate,
        });
      },
      organizationRenamed: async () => undefined,
      organizationOwnershipTransferred: async (record) => {
        transfers.push(record);
      },
    };

    transfer = new TransferOrganizationOwnershipUseCase(
      organizations,
      memberships,
      new SystemClock(),
      events,
    );
  });

  afterAll(async () => {
    // Scoped teardown (R9): only what this suite created, and memberships
    // before organizations even though the FK cascades — relying on the
    // cascade would make this silently correct only while it stays CASCADE.
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

  beforeEach(() => {
    roleChanges.length = 0;
    transfers.length = 0;
  });

  async function newOrganization(): Promise<Organization> {
    const id = randomUUID();
    createdOrganizations.push(id);
    const now = new Date();
    const row = await prisma.organization.create({
      data: {
        id,
        // Suffixed with the id so a run that died before teardown cannot make
        // the next one fail on the slug's unique index.
        slug: `owned-${id.slice(0, 8)}`,
        name: 'Ferretería Sur',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    });
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: 'active',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async function addMember(
    organizationId: string,
    roleTemplate: string,
    status: MembershipStatus = 'active',
  ): Promise<Membership> {
    const userId = randomUUID();
    createdUsers.push(userId);
    const now = new Date();
    const row = await prisma.membership.create({
      data: {
        id: randomUUID(),
        organizationId,
        userId,
        roleTemplate,
        status,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    return row as Membership;
  }

  function actorFor(
    membership: Membership,
    template: Parameters<typeof permissionsForTemplate>[0],
  ): Actor {
    return {
      id: membership.userId,
      organizationId: membership.organizationId,
      permissions: new Set(permissionsForTemplate(template)),
    };
  }

  it('moves owner onto the target and demotes the previous owner, in one write', async () => {
    const organization = await newOrganization();
    const owner = await addMember(organization.id, 'owner');
    const successor = await addMember(organization.id, 'organization_admin');

    await transfer.execute(actorFor(owner, 'owner'), {
      userId: successor.userId,
    });

    const rows = await prisma.membership.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      rows.map((row) => [row.userId, row.roleTemplate, row.version]),
    ).toEqual([
      [owner.userId, 'organization_admin', 2],
      [successor.userId, 'owner', 2],
    ]);
    expect(await memberships.findOwner(organization.id)).toMatchObject({
      userId: successor.userId,
    });
  });

  it('refuses a SECOND owner at the database, not only in the code', async () => {
    /**
     * The partial unique index, tested directly. Everything else in this file
     * would still pass if the migration had never been applied — the use case
     * is careful — so this is the one case that fails when the index is
     * missing, which is exactly the regression worth catching.
     */
    const organization = await newOrganization();
    await addMember(organization.id, 'owner');
    const other = await addMember(organization.id, 'organization_admin');

    await expect(
      prisma.membership.update({
        where: { id: other.id },
        data: { roleTemplate: 'owner' },
      }),
    ).rejects.toBeDefined();

    // And it is PARTIAL: two non-owner memberships in one organization are
    // ordinary, which a total unique index on organization_id would forbid.
    await expect(addMember(organization.id, 'agent')).resolves.toBeDefined();
  });

  it('leaves the ownership exactly as it was when the promotion cannot apply', async () => {
    // The rollback case. Forced the way it could really happen: the receiver
    // is suspended between the use case's read and the repository's write,
    // which the promoting UPDATE re-checks.
    const organization = await newOrganization();
    const owner = await addMember(organization.id, 'owner');
    const successor = await addMember(organization.id, 'organization_admin');

    const result = await memberships.transferOwnership({
      organizationId: organization.id,
      fromMembershipId: owner.id,
      // A membership id from no organization at all, so the promotion matches
      // nothing while the demotion matches perfectly.
      toMembershipId: randomUUID(),
      at: new Date(),
    });

    expect(result).toBeNull();
    // If the demotion had committed, the organization would now have NO owner
    // and nobody able to give it one.
    const rows = await prisma.membership.findMany({
      where: { organizationId: organization.id },
    });
    expect(rows.find((row) => row.id === owner.id)?.roleTemplate).toBe('owner');
    expect(rows.find((row) => row.id === owner.id)?.version).toBe(1);
    expect(rows.find((row) => row.id === successor.id)?.roleTemplate).toBe(
      'organization_admin',
    );
  });

  it('lets exactly one of two concurrent writes move the ownership', async () => {
    /**
     * The claim a fake cannot make, tested at the repository so the race is
     * the only thing in it. Both transactions try to demote the same owner
     * row; the second blocks on that row's lock, re-reads it once the first
     * commits, no longer matches `role_template = 'owner'`, and reports zero
     * rows changed.
     *
     * The assertion is NOT "the first one wins" — under concurrency either
     * may, and it does not matter. What must hold is that one of them answers
     * a transfer and the other answers null, whether they collided on the lock
     * or happened to serialize.
     */
    const organization = await newOrganization();
    const owner = await addMember(organization.id, 'owner');
    const first = await addMember(organization.id, 'organization_admin');
    const second = await addMember(organization.id, 'agent');
    const at = new Date();

    const outcomes = await Promise.all([
      memberships.transferOwnership({
        organizationId: organization.id,
        fromMembershipId: owner.id,
        toMembershipId: first.id,
        at,
      }),
      memberships.transferOwnership({
        organizationId: organization.id,
        fromMembershipId: owner.id,
        toMembershipId: second.id,
        at,
      }),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);

    const owners = await prisma.membership.findMany({
      where: { organizationId: organization.id, roleTemplate: 'owner' },
    });
    expect(owners).toHaveLength(1);
    expect([first.userId, second.userId]).toContain(owners[0].userId);
    // And the loser's target was not touched on the way past.
    const untouched = await prisma.membership.findMany({
      where: {
        organizationId: organization.id,
        id: { in: [first.id, second.id] },
        roleTemplate: { not: 'owner' },
      },
    });
    expect(untouched).toHaveLength(1);
    expect(untouched[0].version).toBe(1);
  });

  it('refuses the second of two concurrent transfers through the use case', async () => {
    /**
     * The same race one layer up, where the refusal a caller actually sees is
     * decided. Both legitimate outcomes are accepted for the loser and the
     * distinction is a scheduling detail rather than a rule: if it reached the
     * repository it is a conflict, and if the winner had already committed
     * before the loser read its own row it is "you are not the owner". Pinning
     * one of them would make this test assert Node's event loop.
     *
     * What is NOT negotiable, and is what this asserts: exactly one succeeds,
     * exactly one is refused, and the organization ends with one owner.
     */
    const organization = await newOrganization();
    const owner = await addMember(organization.id, 'owner');
    const first = await addMember(organization.id, 'organization_admin');
    const second = await addMember(organization.id, 'agent');

    const actor = actorFor(owner, 'owner');
    const outcomes = await Promise.allSettled([
      transfer.execute(actor, { userId: first.userId }),
      transfer.execute(actor, { userId: second.userId }),
    ]);

    const won = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const lost = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    ) as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(
      lost[0].reason instanceof OwnershipTransferConflictError ||
        lost[0].reason instanceof NotOrganizationOwnerError,
    ).toBe(true);

    const owners = await prisma.membership.findMany({
      where: { organizationId: organization.id, roleTemplate: 'owner' },
    });
    expect(owners).toHaveLength(1);
    expect([first.userId, second.userId]).toContain(owners[0].userId);
  });

  it('cannot be started by an administrator, however current their token', async () => {
    const organization = await newOrganization();
    await addMember(organization.id, 'owner');
    const admin = await addMember(organization.id, 'organization_admin');
    const target = await addMember(organization.id, 'agent');

    await expect(
      transfer.execute(actorFor(admin, 'organization_admin'), {
        userId: target.userId,
      }),
    ).rejects.toBeInstanceOf(NotOrganizationOwnerError);

    const owners = await prisma.membership.findMany({
      where: { organizationId: organization.id, roleTemplate: 'owner' },
    });
    expect(owners).toHaveLength(1);
  });

  it('refuses a suspended target and changes nothing', async () => {
    const organization = await newOrganization();
    const owner = await addMember(organization.id, 'owner');
    const suspended = await addMember(
      organization.id,
      'organization_admin',
      'suspended',
    );

    await expect(
      transfer.execute(actorFor(owner, 'owner'), { userId: suspended.userId }),
    ).rejects.toBeInstanceOf(OwnershipTargetNotEligibleError);

    expect(await memberships.findOwner(organization.id)).toMatchObject({
      userId: owner.userId,
    });
  });

  it('cannot reach a member of another organization', async () => {
    // Tenant isolation against the real scoped query rather than a fake's
    // filter: the lookup is scoped by the actor's organization, so a genuine
    // member of a different one is simply not there.
    const mine = await newOrganization();
    const theirs = await newOrganization();
    const owner = await addMember(mine.id, 'owner');
    await addMember(theirs.id, 'owner');
    const outsider = await addMember(theirs.id, 'organization_admin');

    await expect(
      transfer.execute(actorFor(owner, 'owner'), { userId: outsider.userId }),
    ).rejects.toBeDefined();

    const theirOwners = await prisma.membership.findMany({
      where: { organizationId: theirs.id, roleTemplate: 'owner' },
    });
    expect(theirOwners).toHaveLength(1);
    expect(theirOwners[0].userId).not.toBe(outsider.userId);
    expect(await memberships.findOwner(mine.id)).toMatchObject({
      userId: owner.userId,
    });
  });

  it('publishes both role changes and one attributable transfer', async () => {
    const organization = await newOrganization();
    const owner = await addMember(organization.id, 'owner');
    const successor = await addMember(organization.id, 'agent');

    await transfer.execute(actorFor(owner, 'owner'), {
      userId: successor.userId,
    });

    expect(roleChanges).toEqual([
      { userId: owner.userId, from: 'owner', to: 'organization_admin' },
      { userId: successor.userId, from: 'agent', to: 'owner' },
    ]);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      organizationId: organization.id,
      transferredByUserId: owner.userId,
      previousOwnerUserId: owner.userId,
      newOwnerUserId: successor.userId,
      newOwnerPreviousRoleTemplate: 'agent',
    });
  });
});

describe('renaming an organization (real PostgreSQL)', () => {
  let prisma: PrismaService;
  let organizations: PrismaOrganizationRepository;
  let memberships: PrismaMembershipRepository;
  let rename: RenameOrganizationUseCase;
  let read: GetOrganizationUseCase;
  const renames: { previousName: string; name: string }[] = [];
  const createdOrganizations: string[] = [];
  const createdUsers: string[] = [];

  beforeAll(() => {
    prisma = new PrismaService(databaseUrl as string);
    organizations = new PrismaOrganizationRepository(prisma);
    memberships = new PrismaMembershipRepository(prisma);
    rename = new RenameOrganizationUseCase(organizations, new SystemClock(), {
      organizationRenamed: async (organization, previousName) => {
        renames.push({ previousName, name: organization.name });
      },
      organizationOwnershipTransferred: async () => undefined,
    });
    read = new GetOrganizationUseCase(organizations, memberships);
  });

  afterAll(async () => {
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

  beforeEach(() => {
    renames.length = 0;
  });

  it('persists the new name, keeps the slug, and a FRESH read shows it', async () => {
    const id = randomUUID();
    createdOrganizations.push(id);
    const userId = randomUUID();
    createdUsers.push(userId);
    const now = new Date();
    const slug = `renamed-${id.slice(0, 8)}`;
    await prisma.organization.create({
      data: {
        id,
        slug,
        name: 'Ferretería Sur',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.membership.create({
      data: {
        id: randomUUID(),
        organizationId: id,
        userId,
        roleTemplate: 'owner',
        status: 'active',
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    });

    const actor: Actor = {
      id: userId,
      organizationId: id,
      permissions: new Set(permissionsForTemplate('owner')),
    };
    await rename.execute(actor, { name: '  Ferretería   Sur S.R.L. ' });

    // Read back through the use case, from the database, not from the value
    // the write returned: end-to-end scenario A step 5.
    const view = await read.execute(actor);
    expect(view.organization.name).toBe('Ferretería Sur S.R.L.');
    expect(view.organization.slug).toBe(slug);
    expect(view.viewerIsOwner).toBe(true);

    const row = await prisma.organization.findUnique({ where: { id } });
    expect(row?.name).toBe('Ferretería Sur S.R.L.');
    expect(row?.slug).toBe(slug);
    expect(renames).toEqual([
      { previousName: 'Ferretería Sur', name: 'Ferretería Sur S.R.L.' },
    ]);
  });
});
