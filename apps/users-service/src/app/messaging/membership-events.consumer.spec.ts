import type {
  EventSubscription,
  MessagingClient,
  EventContract,
} from '@helpdesk-ai/messaging';
import {
  membershipCreatedV1,
  membershipRoleChangedV1,
  membershipStatusChangedV1,
  MissingTenantContextError,
} from '@helpdesk-ai/messaging';
import {
  ApplyMembershipCreatedUseCase,
  ApplyMembershipRoleChangedUseCase,
  ApplyMembershipStatusChangedUseCase,
} from '../../application/use-cases/apply-membership-events';
import { InMemoryMembershipProjectionRepository } from '../../application/testing/fakes';
import {
  MembershipEventsConsumer,
  MEMBERSHIP_EVENTS_QUEUE,
} from './membership-events.consumer';

type AnySubscription = EventSubscription<EventContract<string, unknown>>;

class CapturingMessagingClient {
  subscription?: AnySubscription;
  closed = false;

  async subscribe(subscription: AnySubscription): Promise<void> {
    this.subscription = subscription;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class CapturingLogger {
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];

  log(message: string): void {
    this.infos.push(message);
  }
  warn(message: string): void {
    this.warnings.push(message);
  }
  error(message: string): void {
    this.errors.push(message);
  }
}

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = '11111111-1111-4111-8111-111111111111';
const MEMBERSHIP = '77777777-7777-4777-8777-777777777777';

function buildConsumer() {
  const messaging = new CapturingMessagingClient();
  const memberships = new InMemoryMembershipProjectionRepository();
  const logger = new CapturingLogger();
  const consumer = new MembershipEventsConsumer(
    messaging as unknown as MessagingClient,
    new ApplyMembershipCreatedUseCase(memberships),
    new ApplyMembershipStatusChangedUseCase(memberships),
    new ApplyMembershipRoleChangedUseCase(memberships),
    logger,
  );
  return { messaging, memberships, logger, consumer };
}

describe('MembershipEventsConsumer', () => {
  it('subscribes its own durable queue to the three membership contracts and projects deliveries', async () => {
    const { messaging, memberships, consumer } = buildConsumer();

    await consumer.start();

    expect(messaging.subscription?.queue).toBe(MEMBERSHIP_EVENTS_QUEUE);
    expect(
      messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([
      membershipCreatedV1.type,
      membershipStatusChangedV1.type,
      membershipRoleChangedV1.type,
    ]);

    await messaging.subscription?.handler({
      id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      type: 'membership.created.v1',
      occurredAt: '2026-07-30T12:00:00.100Z',
      organizationId: ORG,
      payload: {
        membershipId: MEMBERSHIP,
        organizationId: ORG,
        userId: USER,
        roleTemplate: 'agent',
        status: 'active',
        createdAt: '2026-07-30T12:00:00.000Z',
      },
    });
    await messaging.subscription?.handler({
      id: '8d2f1c8f-5e3a-4c8f-9b4f-0b2c3d4e5f6a',
      type: 'membership.status-changed.v1',
      occurredAt: '2026-07-30T13:00:00.100Z',
      organizationId: ORG,
      payload: {
        membershipId: MEMBERSHIP,
        organizationId: ORG,
        userId: USER,
        fromStatus: 'active',
        toStatus: 'suspended',
        version: 2,
        changedAt: '2026-07-30T13:00:00.000Z',
      },
    });
    await messaging.subscription?.handler({
      id: '9f4b2e0a-7a5c-4e0a-8d6a-2d4e5f6a7b8c',
      type: 'membership.role-changed.v1',
      occurredAt: '2026-07-30T14:00:00.100Z',
      organizationId: ORG,
      payload: {
        membershipId: MEMBERSHIP,
        organizationId: ORG,
        userId: USER,
        fromTemplate: 'agent',
        toTemplate: 'branch_manager',
        version: 3,
        changedAt: '2026-07-30T14:00:00.000Z',
      },
    });

    const stored = memberships.rows.get(`${ORG}:${USER}`);
    expect(stored?.roleTemplate).toBe('branch_manager');
    // The role change leaves the status alone: it carries no status fact.
    expect(stored?.status).toBe('suspended');
    // updated_at comes from the payload's own timestamp, not the envelope's.
    expect(stored?.updatedAt).toEqual(new Date('2026-07-30T14:00:00.000Z'));
  });

  it('warns and projects nothing for a role-change on an unseen edge', async () => {
    const { messaging, memberships, logger, consumer } = buildConsumer();
    await consumer.start();

    await messaging.subscription?.handler({
      id: '0a5c3f1b-8b6d-4f1b-9e7b-3e5f6a7b8c9d',
      type: 'membership.role-changed.v1',
      occurredAt: '2026-07-30T14:00:00.100Z',
      organizationId: ORG,
      payload: {
        membershipId: MEMBERSHIP,
        organizationId: ORG,
        userId: USER,
        fromTemplate: 'requester',
        toTemplate: 'agent',
        version: 2,
        changedAt: '2026-07-30T14:00:00.000Z',
      },
    });

    // No placeholder row, unlike status-changed (see the port contract).
    expect(memberships.rows.size).toBe(0);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('backfill-directory-memberships.sh');
  });

  it('rejects a tenantless envelope so it dead-letters instead of projecting', async () => {
    const { messaging, memberships, consumer } = buildConsumer();
    await consumer.start();

    await expect(
      messaging.subscription?.handler({
        id: '9e3a2d9f-6f4b-4d9f-8c5f-1c3d4e5f6a7b',
        type: 'membership.created.v1',
        occurredAt: '2026-07-30T12:00:00.100Z',
        // organizationId deliberately absent from the envelope.
        payload: {
          membershipId: MEMBERSHIP,
          organizationId: ORG,
          userId: USER,
          roleTemplate: 'agent',
          status: 'active',
          createdAt: '2026-07-30T12:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);

    expect(memberships.rows.size).toBe(0);
  });

  it('closes its messaging client on shutdown', async () => {
    const { messaging, consumer } = buildConsumer();

    await consumer.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
