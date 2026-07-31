/**
 * Sprint 9.5's key integration, against the real broker and database: a
 * created branch reaches a queue as branch.created.v1 with the tenant on
 * the envelope (the fact tickets-service's projection will consume), a role
 * change is announced and immediately visible to mint-time resolution, and
 * a branch assignment lands in the resolution's frozen `branchIds` shape.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/organizations-service:test-integration`, which
 * injects DATABASE_URL (helpdesk_organizations_test) and RABBITMQ_URL.
 *
 * The capture queue is durable on the shared local broker, so assertions
 * target only rows created by this run's random identifiers.
 */
import { randomUUID } from 'node:crypto';
import {
  MessagingClient,
  branchCreatedV1,
  branchUpdatedV1,
  membershipRoleChangedV1,
  type ContractEnvelope,
} from '@helpdesk-ai/messaging';
import { SystemClock } from '../../application/ports/organization.repository';
import { AssignBranchMembershipUseCase } from '../../application/use-cases/assign-branch-membership';
import { ChangeMembershipRoleUseCase } from '../../application/use-cases/change-membership-role';
import { CreateBranchUseCase } from '../../application/use-cases/create-branch';
import { EnsureMembershipUseCase } from '../../application/use-cases/ensure-membership';
import { ResolveActiveMembershipUseCase } from '../../application/use-cases/resolve-active-membership';
import { UpdateBranchUseCase } from '../../application/use-cases/update-branch';
import { BOOTSTRAP_ORGANIZATION_SLUG } from '../../domain/organization';
import { RabbitMqEventPublisher } from '../../infrastructure/messaging/rabbitmq-event-publisher';
import { PrismaBranchMembershipRepository } from '../../infrastructure/prisma/prisma-branch-membership.repository';
import { PrismaBranchRepository } from '../../infrastructure/prisma/prisma-branch.repository';
import { PrismaMembershipRepository } from '../../infrastructure/prisma/prisma-membership.repository';
import { PrismaOrganizationRepository } from '../../infrastructure/prisma/prisma-organization.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UuidGenerator } from '../../infrastructure/uuid-generator';

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

describe('structure events (real broker, real database)', () => {
  let prisma: PrismaService;
  let organizationId: string;
  let createBranch: CreateBranchUseCase;
  let updateBranch: UpdateBranchUseCase;
  let ensureMembership: EnsureMembershipUseCase;
  let changeMembershipRole: ChangeMembershipRoleUseCase;
  let assignBranchMembership: AssignBranchMembershipUseCase;
  let resolveActiveMembership: ResolveActiveMembershipUseCase;
  let publisherClient: MessagingClient;
  let consumerClient: MessagingClient;
  const branchCreatedEvents: ContractEnvelope<typeof branchCreatedV1>[] = [];
  const branchUpdatedEvents: ContractEnvelope<typeof branchUpdatedV1>[] = [];
  const roleChangedEvents: ContractEnvelope<typeof membershipRoleChangedV1>[] =
    [];

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    const organizations = new PrismaOrganizationRepository(prisma);
    const memberships = new PrismaMembershipRepository(prisma);
    const branches = new PrismaBranchRepository(prisma);
    const branchMemberships = new PrismaBranchMembershipRepository(prisma);
    const clock = new SystemClock();
    const ids = new UuidGenerator();

    // Branches cascade into branch_memberships; memberships were already
    // this suite's to clean. The bootstrap organization stays — it comes
    // from a migration `migrate deploy` will not re-run.
    await prisma.branch.deleteMany();
    await prisma.membership.deleteMany();

    publisherClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'organizations-service-int-structure-publisher',
    });
    consumerClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'organizations-service-int-structure-consumer',
    });
    const events = new RabbitMqEventPublisher(publisherClient);

    createBranch = new CreateBranchUseCase(
      organizations,
      branches,
      clock,
      ids,
      events,
    );
    updateBranch = new UpdateBranchUseCase(branches, clock, events);
    ensureMembership = new EnsureMembershipUseCase(
      organizations,
      memberships,
      clock,
      ids,
      events,
    );
    changeMembershipRole = new ChangeMembershipRoleUseCase(
      memberships,
      clock,
      events,
    );
    assignBranchMembership = new AssignBranchMembershipUseCase(
      memberships,
      branches,
      branchMemberships,
      clock,
    );
    resolveActiveMembership = new ResolveActiveMembershipUseCase(
      memberships,
      organizations,
      branchMemberships,
    );

    const bootstrap = await organizations.findBySlug(
      BOOTSTRAP_ORGANIZATION_SLUG,
    );
    if (!bootstrap) {
      throw new Error('bootstrap organization missing; run migrate deploy');
    }
    organizationId = bootstrap.id;

    await consumerClient.subscribe({
      queue: 'organizations-service.int-structure-events',
      contracts: [branchCreatedV1, branchUpdatedV1, membershipRoleChangedV1],
      handler: async (event) => {
        if (event.type === branchCreatedV1.type) {
          branchCreatedEvents.push(
            event as ContractEnvelope<typeof branchCreatedV1>,
          );
        } else if (event.type === branchUpdatedV1.type) {
          branchUpdatedEvents.push(
            event as ContractEnvelope<typeof branchUpdatedV1>,
          );
        } else {
          roleChangedEvents.push(
            event as ContractEnvelope<typeof membershipRoleChangedV1>,
          );
        }
      },
    });
  });

  afterAll(async () => {
    await publisherClient.close();
    await consumerClient.close();
    await prisma.branch.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.$disconnect();
  });

  it('announces a created branch with the tenant on the envelope', async () => {
    const code = `store-${randomUUID()}`;
    const branch = await createBranch.execute({
      organizationId,
      code,
      name: 'Store 12',
      timezone: 'America/Argentina/Buenos_Aires',
    });

    const announced = await waitFor(async () => {
      return (
        branchCreatedEvents.find((event) => event.payload.code === code) ?? null
      );
    });

    // The whole point of D4: the envelope carries the tenant where routing
    // consumers read it, and the payload restates it as the fact
    // tickets-service projects into branch_refs.
    expect(announced.organizationId).toBe(organizationId);
    expect(announced.payload.organizationId).toBe(organizationId);
    expect(announced.payload.branchId).toBe(branch.id);
    expect(announced.payload.status).toBe('active');
    expect(announced.payload.timezone).toBe('America/Argentina/Buenos_Aires');
  });

  it('announces an archive as branch.updated.v1', async () => {
    const code = `store-${randomUUID()}`;
    const branch = await createBranch.execute({
      organizationId,
      code,
      name: 'Closing store',
    });

    await updateBranch.execute({
      organizationId,
      branchId: branch.id,
      status: 'archived',
    });

    const announced = await waitFor(async () => {
      return (
        branchUpdatedEvents.find((event) => event.payload.code === code) ?? null
      );
    });
    expect(announced.organizationId).toBe(organizationId);
    expect(announced.payload.status).toBe('archived');
  });

  it('announces a role change and resolution reflects the new template', async () => {
    const userId = randomUUID();
    await ensureMembership.execute({ userId, roles: ['user'] });

    await changeMembershipRole.execute({
      organizationId,
      userId,
      roleTemplate: 'branch_manager',
    });

    const announced = await waitFor(async () => {
      return (
        roleChangedEvents.find((event) => event.payload.userId === userId) ??
        null
      );
    });
    expect(announced.organizationId).toBe(organizationId);
    expect(announced.payload.fromTemplate).toBe('requester');
    expect(announced.payload.toTemplate).toBe('branch_manager');
    expect(announced.payload.version).toBe(2);

    // The next token this user gets carries the new template's permissions
    // — including the branch-scoped read this sprint wires end to end.
    const resolved = await resolveActiveMembership.execute(userId);
    expect(resolved?.membershipVersion).toBe(2);
    expect(resolved?.permissions).toContain('tickets.read_branch');
  });

  it('surfaces an assigned branch in the resolution branch set', async () => {
    const userId = randomUUID();
    await ensureMembership.execute({ userId, roles: ['user'] });
    const branch = await createBranch.execute({
      organizationId,
      code: `store-${randomUUID()}`,
      name: 'Covered store',
    });

    await assignBranchMembership.execute({
      organizationId,
      userId,
      branchId: branch.id,
    });

    const resolved = await resolveActiveMembership.execute(userId);
    expect(resolved?.branchIds).toEqual([branch.id]);

    // Idempotency under replay: a second PUT-shaped assign is the same edge.
    await assignBranchMembership.execute({
      organizationId,
      userId,
      branchId: branch.id,
    });
    expect((await resolveActiveMembership.execute(userId))?.branchIds).toEqual([
      branch.id,
    ]);
  });
});
