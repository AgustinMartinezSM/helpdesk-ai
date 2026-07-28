/**
 * The sprint's key integration: a user.registered.v1 event published to the
 * real broker lands as a row in the real database through the actual
 * consumer, and redelivery stays idempotent.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/users-service:test-integration`, which injects
 * DATABASE_URL (helpdesk_users_test) and RABBITMQ_URL.
 *
 * The queue is the service's real durable queue on the shared local broker,
 * so assertions target only rows created by this run's random identifiers —
 * stray messages from other local activity simply project extra rows into
 * the test database, which each run wipes.
 */
import { randomUUID } from 'node:crypto';
import { MessagingClient, userRegisteredV1 } from '@helpdesk-ai/messaging';
import { SystemClock } from '../../application/ports/user-profile.repository';
import { RegisterUserProfileUseCase } from '../../application/use-cases/register-user-profile';
import { PrismaUserProfileRepository } from '../../infrastructure/prisma/prisma-user-profile.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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
  let publisherClient: MessagingClient;
  let consumerClient: MessagingClient;
  let consumer: RegistrationConsumer;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    repository = new PrismaUserProfileRepository(prisma);
    await prisma.userProfile.deleteMany();

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
  });

  afterAll(async () => {
    await publisherClient.close();
    await consumerClient.close();
    await prisma.userProfile.deleteMany();
    await prisma.$disconnect();
  });

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
    expect(profile.roles).toEqual(['user']);
    expect(profile.registeredAt).toEqual(new Date('2026-07-28T12:00:00.000Z'));

    // Redelivery must not duplicate or corrupt the projection.
    await publisherClient.publish(userRegisteredV1, payload);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const rows = await prisma.userProfile.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toEqual(profile.createdAt);
  });
});
