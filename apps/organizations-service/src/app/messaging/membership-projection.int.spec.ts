/**
 * The sprint's key integration: a user.registered.v1 event published to the
 * real broker becomes a real membership row in the bootstrap organization,
 * and redelivery does not disturb it.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/organizations-service:test-integration`, which injects
 * DATABASE_URL (helpdesk_organizations_test) and RABBITMQ_URL.
 *
 * The queue is the service's real durable queue on the shared local broker,
 * so assertions target only rows created by this run's random identifiers.
 */
import { randomUUID } from 'node:crypto';
import {
  MessagingClient,
  membershipCreatedV1,
  membershipStatusChangedV1,
  userRegisteredV1,
  type ContractEnvelope,
} from '@helpdesk-ai/messaging';
import { SystemClock } from '../../application/ports/organization.repository';
import { ChangeMembershipStatusUseCase } from '../../application/use-cases/change-membership-status';
import { EnsureMembershipUseCase } from '../../application/use-cases/ensure-membership';
import { ResolveActiveMembershipUseCase } from '../../application/use-cases/resolve-active-membership';
import { BOOTSTRAP_ORGANIZATION_SLUG } from '../../domain/organization';
import { RabbitMqEventPublisher } from '../../infrastructure/messaging/rabbitmq-event-publisher';
import { PrismaMembershipRepository } from '../../infrastructure/prisma/prisma-membership.repository';
import { PrismaOrganizationRepository } from '../../infrastructure/prisma/prisma-organization.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UuidGenerator } from '../../infrastructure/uuid-generator';
import { RegistrationConsumer } from './registration.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/organizations-service:test-integration` with the compose stack up.',
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

describe('membership provisioning (real broker, real database)', () => {
  let prisma: PrismaService;
  let organizations: PrismaOrganizationRepository;
  let memberships: PrismaMembershipRepository;
  let resolveActiveMembership: ResolveActiveMembershipUseCase;
  let changeMembershipStatus: ChangeMembershipStatusUseCase;
  let publisherClient: MessagingClient;
  let consumerClient: MessagingClient;
  let consumer: RegistrationConsumer;
  const membershipCreatedEvents: ContractEnvelope<
    typeof membershipCreatedV1
  >[] = [];
  const membershipStatusChangedEvents: ContractEnvelope<
    typeof membershipStatusChangedV1
  >[] = [];

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    organizations = new PrismaOrganizationRepository(prisma);
    memberships = new PrismaMembershipRepository(prisma);
    resolveActiveMembership = new ResolveActiveMembershipUseCase(
      memberships,
      organizations,
    );
    // Only memberships are wiped. The bootstrap organization comes from a
    // migration, and `migrate deploy` will not re-insert it on the next run —
    // deleting it here would leave every later run without its anchor.
    await prisma.membership.deleteMany();

    consumerClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'organizations-service-int-consumer',
    });
    publisherClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'organizations-service-int-publisher',
    });

    const events = new RabbitMqEventPublisher(publisherClient);
    changeMembershipStatus = new ChangeMembershipStatusUseCase(
      memberships,
      new SystemClock(),
      events,
    );
    consumer = new RegistrationConsumer(
      consumerClient,
      new EnsureMembershipUseCase(
        organizations,
        memberships,
        new SystemClock(),
        new UuidGenerator(),
        events,
      ),
    );
    await consumer.start();

    // A durable capture queue for what THIS service publishes. Like the
    // consumer queue above it persists on the shared local broker, so every
    // assertion targets only this run's random identifiers.
    await consumerClient.subscribe({
      queue: 'organizations-service.int-membership-events',
      contracts: [membershipCreatedV1, membershipStatusChangedV1],
      handler: async (event) => {
        if (event.type === membershipCreatedV1.type) {
          membershipCreatedEvents.push(
            event as ContractEnvelope<typeof membershipCreatedV1>,
          );
        } else {
          membershipStatusChangedEvents.push(
            event as ContractEnvelope<typeof membershipStatusChangedV1>,
          );
        }
      },
    });
  });

  afterAll(async () => {
    await publisherClient.close();
    await consumerClient.close();
    await prisma.membership.deleteMany();
    await prisma.$disconnect();
  });

  it('provisions the bootstrap organization through the migration', async () => {
    const organization = await organizations.findBySlug(
      BOOTSTRAP_ORGANIZATION_SLUG,
    );
    expect(organization?.status).toBe('active');
  });

  it('turns a published registration into an active membership, idempotently', async () => {
    const userId = randomUUID();
    const payload = {
      userId,
      email: `${randomUUID()}@example.com`,
      roles: ['user', 'agent'],
      registeredAt: '2026-07-30T12:00:00.000Z',
    };

    await publisherClient.publish(userRegisteredV1, payload);

    const created = await waitFor(async () => {
      const [membership] = await memberships.listByUser(userId);
      return membership ?? null;
    });
    expect(created.roleTemplate).toBe('agent');
    expect(created.status).toBe('active');
    expect(created.version).toBe(1);

    // Redelivery must not duplicate the row, and must not touch the one that
    // is there — a membership is a source of truth, not a projection.
    await publisherClient.publish(userRegisteredV1, payload);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const rows = await prisma.membership.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(created.id);
    expect(rows[0].updatedAt).toEqual(created.updatedAt);
  });

  it('resolves the membership the way auth-service will at mint time', async () => {
    const userId = randomUUID();
    await publisherClient.publish(userRegisteredV1, {
      userId,
      email: `${randomUUID()}@example.com`,
      roles: ['user'],
      registeredAt: '2026-07-30T12:00:00.000Z',
    });

    const resolved = await waitFor(() =>
      resolveActiveMembership.execute(userId),
    );

    const bootstrap = await organizations.findBySlug(
      BOOTSTRAP_ORGANIZATION_SLUG,
    );
    expect(resolved.organizationId).toBe(bootstrap?.id);
    expect(resolved.membershipVersion).toBe(1);
    // The code map's answer for a requester — the first evaluator increment
    // (ADR 0015); seeded rows are still pending.
    expect(resolved.permissions).toContain('tickets.read_own');
  });

  it('leaves a user with no membership unresolved rather than guessing', async () => {
    expect(await resolveActiveMembership.execute(randomUUID())).toBeNull();
  });

  it('announces a consumed registration as membership.created.v1, tenant on the envelope', async () => {
    const userId = randomUUID();
    await publisherClient.publish(userRegisteredV1, {
      userId,
      email: `${randomUUID()}@example.com`,
      roles: ['user', 'agent'],
      registeredAt: '2026-07-30T12:00:00.000Z',
    });

    const announced = await waitFor(async () => {
      return (
        membershipCreatedEvents.find(
          (event) => event.payload.userId === userId,
        ) ?? null
      );
    });

    // The whole round trip: consumed from the broker, projected, and
    // announced back onto it with the bootstrap organization stamped where
    // tenancy-routing consumers read it — the envelope.
    const bootstrap = await organizations.findBySlug(
      BOOTSTRAP_ORGANIZATION_SLUG,
    );
    expect(announced.organizationId).toBe(bootstrap?.id);
    expect(announced.payload.organizationId).toBe(bootstrap?.id);
    expect(announced.payload.roleTemplate).toBe('agent');
    expect(announced.payload.status).toBe('active');
  });

  it('publishes the suspension, stops resolving, and resolves again on reinstatement', async () => {
    const userId = randomUUID();
    await publisherClient.publish(userRegisteredV1, {
      userId,
      email: `${randomUUID()}@example.com`,
      roles: ['user'],
      registeredAt: '2026-07-30T12:00:00.000Z',
    });
    const created = await waitFor(() =>
      resolveActiveMembership.execute(userId),
    );
    const organizationId = created.organizationId;

    await changeMembershipStatus.execute({
      organizationId,
      userId,
      to: 'suspended',
    });

    const suspended = await waitFor(async () => {
      return (
        membershipStatusChangedEvents.find(
          (event) => event.payload.userId === userId,
        ) ?? null
      );
    });
    expect(suspended.organizationId).toBe(organizationId);
    expect(suspended.payload.fromStatus).toBe('active');
    expect(suspended.payload.toStatus).toBe('suspended');
    expect(suspended.payload.version).toBe(2);

    // A suspended membership resolves to nothing: the next token this user
    // gets carries no organization.
    expect(await resolveActiveMembership.execute(userId)).toBeNull();

    await changeMembershipStatus.execute({
      organizationId,
      userId,
      to: 'active',
    });

    const reinstated = await resolveActiveMembership.execute(userId);
    expect(reinstated?.organizationId).toBe(organizationId);
    // Bumped twice since creation: any token minted before the suspension
    // still says mv 1 and is detectably stale.
    expect(reinstated?.membershipVersion).toBe(3);
  });
});
