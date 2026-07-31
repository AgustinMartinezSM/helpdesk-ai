/**
 * The sprint's key integration: a user.registered.v1 event published to the
 * real broker lands as a row in the real database through the actual
 * consumer, and redelivery stays idempotent. As of the tenancy sprint the
 * same applies to the membership events feeding the directory projection,
 * plus the scoped directory listing they exist for.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/users-service:test-integration`, which injects
 * DATABASE_URL (helpdesk_users_test) and RABBITMQ_URL.
 *
 * The queues are the service's real durable queues on the shared local
 * broker, so assertions target only rows created by this run's random
 * identifiers — stray messages from other local activity simply project
 * extra rows into the test database, which each run wipes.
 */
import { randomUUID } from 'node:crypto';
import {
  MessagingClient,
  membershipCreatedV1,
  membershipStatusChangedV1,
  userRegisteredV1,
} from '@helpdesk-ai/messaging';
import { SystemClock } from '../../application/ports/user-profile.repository';
import {
  ApplyMembershipCreatedUseCase,
  ApplyMembershipStatusChangedUseCase,
} from '../../application/use-cases/apply-membership-events';
import { RegisterUserProfileUseCase } from '../../application/use-cases/register-user-profile';
import { PrismaMembershipProjectionRepository } from '../../infrastructure/prisma/prisma-membership-projection.repository';
import { PrismaUserProfileRepository } from '../../infrastructure/prisma/prisma-user-profile.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MembershipEventsConsumer } from './membership-events.consumer';
import { RegistrationConsumer } from './registration.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/users-service:test-integration` with the compose stack up.',
  );
}

async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== null) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error('condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('user profile projection (real broker, real database)', () => {
  let prisma: PrismaService;
  let repository: PrismaUserProfileRepository;
  let memberships: PrismaMembershipProjectionRepository;
  let publisherClient: MessagingClient;
  let consumerClient: MessagingClient;
  let consumer: RegistrationConsumer;
  let membershipConsumer: MembershipEventsConsumer;

  /** Wipes both tables. Unfiltered deleteMany is R9 debt, noted as such:
   * it assumes helpdesk_users_test belongs to this run alone, which holds
   * locally today but will not survive parallel suites. */
  async function wipe(): Promise<void> {
    await prisma.userProfile.deleteMany();
    await prisma.directoryMembership.deleteMany();
  }

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    repository = new PrismaUserProfileRepository(prisma);
    memberships = new PrismaMembershipProjectionRepository(prisma);
    await wipe();

    consumerClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'users-service-int-consumer',
    });
    publisherClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'users-service-int-publisher',
    });

    consumer = new RegistrationConsumer(
      consumerClient,
      new RegisterUserProfileUseCase(repository, new SystemClock()),
    );
    await consumer.start();

    // Both subscriptions share one connection, as they do in the service.
    membershipConsumer = new MembershipEventsConsumer(
      consumerClient,
      new ApplyMembershipCreatedUseCase(memberships),
      new ApplyMembershipStatusChangedUseCase(memberships),
    );
    await membershipConsumer.start();
  });

  afterAll(async () => {
    await publisherClient.close();
    await consumerClient.close();
    await wipe();
    await prisma.$disconnect();
  });

  async function publishMembership(
    organizationId: string,
    userId: string,
    roleTemplate: string,
    createdAt: string,
  ): Promise<void> {
    await publisherClient.publish(
      membershipCreatedV1,
      {
        membershipId: randomUUID(),
        organizationId,
        userId,
        roleTemplate,
        status: 'active',
        createdAt,
      },
      { organizationId },
    );
  }

  function membershipRow(organizationId: string, userId: string) {
    return prisma.directoryMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
  }

  it('projects a published registration into a profile row, idempotently', async () => {
    const userId = randomUUID();
    const email = `${randomUUID()}@example.com`;
    const payload = {
      userId,
      email,
      roles: ['user'],
      registeredAt: '2026-07-28T12:00:00.000Z',
    };

    await publisherClient.publish(userRegisteredV1, payload);

    const profile = await waitFor(() => repository.findByUserId(userId));
    expect(profile.email).toBe(email);
    expect(profile.displayName).toBe(email.split('@')[0]);
    expect(profile.registeredAt).toEqual(new Date('2026-07-28T12:00:00.000Z'));

    // Redelivery must not duplicate or corrupt the projection.
    await publisherClient.publish(userRegisteredV1, payload);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const rows = await prisma.userProfile.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toEqual(profile.createdAt);
  });

  it('projects membership lifecycle events into directory rows through the LWW upsert', async () => {
    const organizationId = randomUUID();
    const userId = randomUUID();

    await publishMembership(
      organizationId,
      userId,
      'agent',
      '2026-07-30T12:00:00.000Z',
    );

    const created = await waitFor(() => membershipRow(organizationId, userId));
    expect(created.roleTemplate).toBe('agent');
    expect(created.status).toBe('active');
    expect(created.updatedAt).toEqual(new Date('2026-07-30T12:00:00.000Z'));

    await publisherClient.publish(
      membershipStatusChangedV1,
      {
        membershipId: randomUUID(),
        organizationId,
        userId,
        fromStatus: 'active',
        toStatus: 'suspended',
        version: 2,
        changedAt: '2026-07-30T13:00:00.000Z',
      },
      { organizationId },
    );

    const suspended = await waitFor(async () => {
      const row = await membershipRow(organizationId, userId);
      return row?.status === 'suspended' ? row : null;
    });
    // role_template survives a status change; updated_at is the payload's.
    expect(suspended.roleTemplate).toBe('agent');
    expect(suspended.updatedAt).toEqual(new Date('2026-07-30T13:00:00.000Z'));
  });

  it('scopes the directory listing end-to-end against the real database', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const insiderId = randomUUID();
    const outsiderId = randomUUID();

    for (const userId of [insiderId, outsiderId]) {
      await publisherClient.publish(userRegisteredV1, {
        userId,
        email: `${userId}@example.com`,
        roles: ['user'],
        registeredAt: '2026-07-28T12:00:00.000Z',
      });
    }
    await publishMembership(
      orgA,
      insiderId,
      'requester',
      '2026-07-30T12:00:00.000Z',
    );
    await publishMembership(
      orgB,
      outsiderId,
      'requester',
      '2026-07-30T12:00:00.000Z',
    );

    await waitFor(() => repository.findByUserId(insiderId));
    await waitFor(() => repository.findByUserId(outsiderId));
    await waitFor(() => membershipRow(orgA, insiderId));
    await waitFor(() => membershipRow(orgB, outsiderId));

    // Isolation BY IDENTITY: the outsider's only membership is org B, so no
    // amount of profile data may surface them in org A's directory.
    const directoryA = await repository.list(orgA);
    expect(directoryA.map((profile) => profile.userId)).toEqual([insiderId]);

    const directoryB = await repository.list(orgB);
    expect(directoryB.map((profile) => profile.userId)).toEqual([outsiderId]);
  });
});
