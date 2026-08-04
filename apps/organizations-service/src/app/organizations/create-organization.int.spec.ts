/**
 * Creating an organization against a REAL PostgreSQL database.
 *
 * The unit suite covers the rules with fakes and the controller suite covers
 * the HTTP contract. What only a real database can show is the part the
 * others take on trust: that both rows land in one transaction, that the
 * unique index is what actually guarantees slug uniqueness, and that a
 * concurrent second create by the same person cannot produce two
 * organizations.
 */
import { randomUUID } from 'node:crypto';
import type { Actor } from '@helpdesk-ai/security';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PrismaOrganizationRepository } from '../../infrastructure/prisma/prisma-organization.repository';
import { CreateOrganizationUseCase } from '../../application/use-cases/create-organization';
import { BOOTSTRAP_ORGANIZATION_SLUG } from '../../domain/organization';
import type { MembershipEventPublisher } from '../../application/ports/event-publisher';
import { SystemClock } from '../../application/ports/organization.repository';
import { UuidGenerator } from '../../infrastructure/uuid-generator';
import type { Membership } from '../../domain/membership';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL must be set. Run via `nx run @helpdesk-ai/organizations-service:test-integration` with the compose stack up.',
  );
}

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';

describe('creating an organization (real PostgreSQL)', () => {
  let prisma: PrismaService;
  let useCase: CreateOrganizationUseCase;
  const published: Membership[] = [];
  /** Everything this suite made, so teardown removes only its own rows. */
  const createdOrganizations: string[] = [];
  const createdUsers: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);

    const events: MembershipEventPublisher = {
      membershipCreated: async (membership: Membership) => {
        published.push(membership);
      },
      membershipStatusChanged: async () => undefined,
      membershipRoleChanged: async () => undefined,
    };

    useCase = new CreateOrganizationUseCase(
      new PrismaOrganizationRepository(prisma),
      new SystemClock(),
      new UuidGenerator(),
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
    published.length = 0;
  });

  /** A person as registration leaves them: in the holding pen, nowhere else. */
  let lastBootstrapMembershipId = '';

  async function newcomer(): Promise<Actor> {
    const userId = randomUUID();
    createdUsers.push(userId);
    const now = new Date();
    lastBootstrapMembershipId = randomUUID();
    await prisma.membership.create({
      data: {
        id: lastBootstrapMembershipId,
        organizationId: BOOTSTRAP_ID,
        userId,
        roleTemplate: 'requester',
        status: 'active',
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    return { id: userId, permissions: new Set<string>() };
  }

  it('commits the organization and its owner membership together', async () => {
    const actor = await newcomer();

    const created = await useCase.execute(actor, { name: 'Ferretería Sur' });
    createdOrganizations.push(created.organization.id);

    const organizationRow = await prisma.organization.findUnique({
      where: { id: created.organization.id },
    });
    const membershipRow = await prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: created.organization.id,
          userId: actor.id,
        },
      },
    });

    // startsWith rather than an exact match: this database is shared between
    // suites, and a previous run that died before teardown would still hold
    // the un-suffixed slug. The fixture's own comment records the same trap.
    expect(organizationRow?.slug.startsWith('ferreteria-sur')).toBe(true);
    expect(organizationRow?.status).toBe('active');
    expect(membershipRow?.roleTemplate).toBe('owner');
    expect(membershipRow?.status).toBe('active');
    expect(published).toHaveLength(1);
  });

  it('leaves NOTHING behind when the membership insert fails', async () => {
    /**
     * The whole reason the repository owns a transaction. If the two writes
     * were separate, a failure on the second would leave an organization
     * nobody can administer — and there is no outbox to repair it with
     * (ADR 0006), so it would be permanent.
     *
     * The failure is forced the way it could really happen: the same person
     * already has a membership in that organization, which the unique index
     * refuses.
     */
    const actor = await newcomer();
    const organizationId = randomUUID();
    createdOrganizations.push(organizationId);
    const now = new Date();

    const repository = new PrismaOrganizationRepository(prisma);
    await expect(
      repository.createWithOwner(
        {
          id: organizationId,
          slug: `doomed-${organizationId.slice(0, 8)}`,
          name: 'Doomed',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        },
        {
          // A membership id that already exists, so the insert violates the
          // primary key. Deterministic, and a failure shaped like one that
          // could really happen rather than an injected fault.
          id: lastBootstrapMembershipId,
          organizationId,
          userId: actor.id,
          roleTemplate: 'owner',
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ),
    ).rejects.toBeDefined();

    // The organization must not exist. If it does, the transaction is a lie.
    const orphan = await prisma.organization.findUnique({
      where: { id: organizationId },
    });
    expect(orphan).toBeNull();
  });

  it('gives two organizations of the same name two different slugs', async () => {
    // The unique index is the real guarantee; the derivation only proposes.
    const first = await newcomer();
    const second = await newcomer();

    const a = await useCase.execute(first, { name: 'Panadería Central' });
    createdOrganizations.push(a.organization.id);
    const b = await useCase.execute(second, { name: 'Panadería Central' });
    createdOrganizations.push(b.organization.id);

    expect(a.organization.slug).not.toBe(b.organization.slug);
    expect(a.organization.slug.startsWith('panaderia-central')).toBe(true);
    expect(b.organization.slug.startsWith('panaderia-central')).toBe(true);
  });

  it('lets one person own two organizations, each with its own owner row', async () => {
    // Refused from Sprint 10.4 until 10.6, when token exchange made a second
    // organization reachable (ADR 0025). Worth proving against the database
    // rather than the fakes: the partial unique index that makes a second
    // owner unrepresentable is scoped per organization_id, so the SAME person
    // holding `owner` twice has to be legal — and an index written one column
    // narrower would refuse it.
    const actor = await newcomer();

    const first = await useCase.execute(actor, { name: 'First' });
    createdOrganizations.push(first.organization.id);
    const second = await useCase.execute(actor, { name: 'Second' });
    createdOrganizations.push(second.organization.id);

    expect(second.organization.id).not.toBe(first.organization.id);
    const owned = await prisma.membership.findMany({
      where: { userId: actor.id, roleTemplate: 'owner' },
    });
    expect(owned).toHaveLength(2);
    expect(owned.map((row) => row.organizationId).sort()).toEqual(
      [first.organization.id, second.organization.id].sort(),
    );
  });

  it('never takes the bootstrap slug, whatever it is asked for', async () => {
    // Provisioning-critical: the bootstrap migration conflicts on id, not
    // slug, so a stolen slug breaks `migrate deploy` on every environment.
    const actor = await newcomer();

    const created = await useCase.execute(actor, { name: 'Bootstrap' });
    createdOrganizations.push(created.organization.id);

    expect(created.organization.slug).not.toBe(BOOTSTRAP_ORGANIZATION_SLUG);
    const anchor = await prisma.organization.findUnique({
      where: { slug: BOOTSTRAP_ORGANIZATION_SLUG },
    });
    expect(anchor?.id).toBe(BOOTSTRAP_ID);
  });
});
