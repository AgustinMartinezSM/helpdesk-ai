import { randomUUID } from 'node:crypto';
import { OTHER_ORGANIZATION, TEST_ORGANIZATION } from '../../testing/fixtures';
import {
  PrismaBranchRefRepository,
  PrismaStationRefRepository,
} from './prisma-structure-refs.repository';
import { PrismaService } from './prisma.service';

// Runs against helpdesk_tickets_test through the test-integration target.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run via `nx run @helpdesk-ai/tickets-service:test-integration` with the compose postgres service up.',
  );
}

describe('structure-ref projections (real PostgreSQL)', () => {
  const prisma = new PrismaService(databaseUrl);
  const branches = new PrismaBranchRefRepository(prisma);
  const stations = new PrismaStationRefRepository(prisma);

  beforeEach(async () => {
    await prisma.stationRef.deleteMany();
    await prisma.branchRef.deleteMany();
  });

  afterAll(async () => {
    await prisma.stationRef.deleteMany();
    await prisma.branchRef.deleteMany();
    await prisma.$disconnect();
  });

  function branchInput(overrides: Record<string, unknown> = {}) {
    return {
      branchId: randomUUID(),
      organizationId: TEST_ORGANIZATION,
      code: 'BR-12',
      name: 'Store 12',
      status: 'active',
      occurredAt: new Date('2026-07-31T12:00:00.000Z'),
      ...overrides,
    };
  }

  it('applies last-writer-wins on the payload timestamp: a stale replay cannot resurrect a branch', async () => {
    const branchId = randomUUID();
    await branches.apply(branchInput({ branchId }));
    await branches.apply(
      branchInput({
        branchId,
        status: 'archived',
        occurredAt: new Date('2026-07-31T13:00:00.000Z'),
      }),
    );
    // The replayed created event predates the archive and must lose.
    await branches.apply(branchInput({ branchId }));

    expect(await branches.findActive(TEST_ORGANIZATION, branchId)).toBeNull();
  });

  it('never answers a foreign branch, by id or by list — same as a missing one', async () => {
    const ours = randomUUID();
    const theirs = randomUUID();
    await branches.apply(branchInput({ branchId: ours }));
    await branches.apply(
      branchInput({ branchId: theirs, organizationId: OTHER_ORGANIZATION }),
    );

    expect(await branches.findActive(TEST_ORGANIZATION, theirs)).toBeNull();
    const listed = await branches.listActive(TEST_ORGANIZATION);
    expect(listed.map((b) => b.id)).toEqual([ours]);
  });

  it('scopes a station by organization AND branch: another branch answers null', async () => {
    const branchX = randomUUID();
    const branchY = randomUUID();
    const stationId = randomUUID();
    await branches.apply(branchInput({ branchId: branchX }));
    await branches.apply(branchInput({ branchId: branchY, code: 'BR-13' }));
    await stations.apply({
      stationId,
      branchId: branchX,
      organizationId: TEST_ORGANIZATION,
      code: 'CASH-2',
      name: 'Cashier station 2',
      area: 'checkout',
      status: 'active',
      occurredAt: new Date('2026-07-31T12:01:00.000Z'),
    });

    expect(
      await stations.findActive(TEST_ORGANIZATION, branchX, stationId),
    ).not.toBeNull();
    expect(
      await stations.findActive(TEST_ORGANIZATION, branchY, stationId),
    ).toBeNull();
    expect(
      await stations.findActive(OTHER_ORGANIZATION, branchX, stationId),
    ).toBeNull();
  });
});
