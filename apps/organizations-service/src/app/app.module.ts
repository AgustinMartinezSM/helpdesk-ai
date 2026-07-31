import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { EVENT_PUBLISHER } from '../application/ports/event-publisher';
import type { OrganizationEventPublisher } from '../application/ports/event-publisher';
import { MEMBERSHIP_REPOSITORY } from '../application/ports/membership.repository';
import type { MembershipRepository } from '../application/ports/membership.repository';
import {
  CLOCK,
  ID_GENERATOR,
  ORGANIZATION_REPOSITORY,
  SystemClock,
  type Clock,
  type IdGenerator,
  type OrganizationRepository,
} from '../application/ports/organization.repository';
import {
  BRANCH_MEMBERSHIP_REPOSITORY,
  BRANCH_REPOSITORY,
  DEPARTMENT_REPOSITORY,
  STATION_REPOSITORY,
  type BranchMembershipRepository,
  type BranchRepository,
  type DepartmentRepository,
  type OperationalStationRepository,
} from '../application/ports/structure.repository';
import { AssignBranchMembershipUseCase } from '../application/use-cases/assign-branch-membership';
import { ChangeMembershipRoleUseCase } from '../application/use-cases/change-membership-role';
import { ChangeMembershipStatusUseCase } from '../application/use-cases/change-membership-status';
import { CreateBranchUseCase } from '../application/use-cases/create-branch';
import { CreateDepartmentUseCase } from '../application/use-cases/create-department';
import { CreateStationUseCase } from '../application/use-cases/create-station';
import { EnsureMembershipUseCase } from '../application/use-cases/ensure-membership';
import { GetMembershipUseCase } from '../application/use-cases/get-membership';
import { RemoveBranchMembershipUseCase } from '../application/use-cases/remove-branch-membership';
import { ResolveActiveMembershipUseCase } from '../application/use-cases/resolve-active-membership';
import { UpdateBranchUseCase } from '../application/use-cases/update-branch';
import { UpdateDepartmentUseCase } from '../application/use-cases/update-department';
import { UpdateStationUseCase } from '../application/use-cases/update-station';
import {
  APP_ENV,
  SERVICE_NAME,
  type OrganizationsServiceEnv,
} from '../config/env';
import { RabbitMqEventPublisher } from '../infrastructure/messaging/rabbitmq-event-publisher';
import { PrismaBranchMembershipRepository } from '../infrastructure/prisma/prisma-branch-membership.repository';
import { PrismaBranchRepository } from '../infrastructure/prisma/prisma-branch.repository';
import { PrismaDepartmentRepository } from '../infrastructure/prisma/prisma-department.repository';
import { PrismaMembershipRepository } from '../infrastructure/prisma/prisma-membership.repository';
import { PrismaOperationalStationRepository } from '../infrastructure/prisma/prisma-operational-station.repository';
import { PrismaOrganizationRepository } from '../infrastructure/prisma/prisma-organization.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { UuidGenerator } from '../infrastructure/uuid-generator';
import { HealthController } from './health/health.controller';
import { InternalMembershipsController } from './internal/internal-memberships.controller';
import { InternalOrganizationMembershipsController } from './internal/internal-organization-memberships.controller';
import { InternalOrganizationStructureController } from './internal/internal-organization-structure.controller';
import { InternalServiceGuard } from './internal/internal-service.guard';
import { RegistrationConsumer } from './messaging/registration.consumer';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 *
 * No JwtModule: this service has no person-facing endpoint yet. Its only
 * surface is the internal resolution call, which authenticates a process
 * rather than a user, so registering token verification would be wiring that
 * guards nothing.
 */
@Module({})
export class AppModule {
  static forRoot(env: OrganizationsServiceEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: SERVICE_NAME,
          environment: env.NODE_ENV,
          logLevel: env.LOG_LEVEL,
        }),
      ],
      controllers: [
        HealthController,
        InternalMembershipsController,
        InternalOrganizationMembershipsController,
        InternalOrganizationStructureController,
      ],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ID_GENERATOR, useClass: UuidGenerator },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: ORGANIZATION_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaOrganizationRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: MEMBERSHIP_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaMembershipRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: BRANCH_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaBranchRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: DEPARTMENT_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaDepartmentRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: STATION_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaOperationalStationRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: BRANCH_MEMBERSHIP_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaBranchMembershipRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: MessagingClient,
          useFactory: (logger: Logger) =>
            new MessagingClient({
              url: env.RABBITMQ_URL,
              serviceName: SERVICE_NAME,
              logger,
            }),
          inject: [Logger],
        },
        {
          // Shares the service's one MessagingClient with the consumer: the
          // adapter publishes on its own channel, and shutdown ownership
          // stays with RegistrationConsumer.
          provide: EVENT_PUBLISHER,
          useFactory: (messaging: MessagingClient, logger: Logger) =>
            new RabbitMqEventPublisher(messaging, logger),
          inject: [MessagingClient, Logger],
        },
        {
          provide: EnsureMembershipUseCase,
          useFactory: (
            organizations: OrganizationRepository,
            memberships: MembershipRepository,
            clock: Clock,
            ids: IdGenerator,
            events: OrganizationEventPublisher,
          ) =>
            new EnsureMembershipUseCase(
              organizations,
              memberships,
              clock,
              ids,
              events,
            ),
          inject: [
            ORGANIZATION_REPOSITORY,
            MEMBERSHIP_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
            EVENT_PUBLISHER,
          ],
        },
        {
          provide: ChangeMembershipStatusUseCase,
          useFactory: (
            memberships: MembershipRepository,
            clock: Clock,
            events: OrganizationEventPublisher,
          ) => new ChangeMembershipStatusUseCase(memberships, clock, events),
          inject: [MEMBERSHIP_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: ChangeMembershipRoleUseCase,
          useFactory: (
            memberships: MembershipRepository,
            clock: Clock,
            events: OrganizationEventPublisher,
          ) => new ChangeMembershipRoleUseCase(memberships, clock, events),
          inject: [MEMBERSHIP_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: GetMembershipUseCase,
          useFactory: (
            memberships: MembershipRepository,
            organizations: OrganizationRepository,
            branchMemberships: BranchMembershipRepository,
          ) =>
            new GetMembershipUseCase(
              memberships,
              organizations,
              branchMemberships,
            ),
          inject: [
            MEMBERSHIP_REPOSITORY,
            ORGANIZATION_REPOSITORY,
            BRANCH_MEMBERSHIP_REPOSITORY,
          ],
        },
        {
          provide: ResolveActiveMembershipUseCase,
          useFactory: (
            memberships: MembershipRepository,
            organizations: OrganizationRepository,
            branchMemberships: BranchMembershipRepository,
          ) =>
            new ResolveActiveMembershipUseCase(
              memberships,
              organizations,
              branchMemberships,
            ),
          inject: [
            MEMBERSHIP_REPOSITORY,
            ORGANIZATION_REPOSITORY,
            BRANCH_MEMBERSHIP_REPOSITORY,
          ],
        },
        {
          provide: CreateBranchUseCase,
          useFactory: (
            organizations: OrganizationRepository,
            branches: BranchRepository,
            clock: Clock,
            ids: IdGenerator,
            events: OrganizationEventPublisher,
          ) =>
            new CreateBranchUseCase(
              organizations,
              branches,
              clock,
              ids,
              events,
            ),
          inject: [
            ORGANIZATION_REPOSITORY,
            BRANCH_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
            EVENT_PUBLISHER,
          ],
        },
        {
          provide: UpdateBranchUseCase,
          useFactory: (
            branches: BranchRepository,
            clock: Clock,
            events: OrganizationEventPublisher,
          ) => new UpdateBranchUseCase(branches, clock, events),
          inject: [BRANCH_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: CreateDepartmentUseCase,
          useFactory: (
            branches: BranchRepository,
            departments: DepartmentRepository,
            clock: Clock,
            ids: IdGenerator,
          ) => new CreateDepartmentUseCase(branches, departments, clock, ids),
          inject: [
            BRANCH_REPOSITORY,
            DEPARTMENT_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
          ],
        },
        {
          provide: UpdateDepartmentUseCase,
          useFactory: (departments: DepartmentRepository, clock: Clock) =>
            new UpdateDepartmentUseCase(departments, clock),
          inject: [DEPARTMENT_REPOSITORY, CLOCK],
        },
        {
          provide: CreateStationUseCase,
          useFactory: (
            branches: BranchRepository,
            stations: OperationalStationRepository,
            memberships: MembershipRepository,
            clock: Clock,
            ids: IdGenerator,
            events: OrganizationEventPublisher,
          ) =>
            new CreateStationUseCase(
              branches,
              stations,
              memberships,
              clock,
              ids,
              events,
            ),
          inject: [
            BRANCH_REPOSITORY,
            STATION_REPOSITORY,
            MEMBERSHIP_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
            EVENT_PUBLISHER,
          ],
        },
        {
          provide: UpdateStationUseCase,
          useFactory: (
            stations: OperationalStationRepository,
            memberships: MembershipRepository,
            clock: Clock,
            events: OrganizationEventPublisher,
          ) => new UpdateStationUseCase(stations, memberships, clock, events),
          inject: [
            STATION_REPOSITORY,
            MEMBERSHIP_REPOSITORY,
            CLOCK,
            EVENT_PUBLISHER,
          ],
        },
        {
          provide: AssignBranchMembershipUseCase,
          useFactory: (
            memberships: MembershipRepository,
            branches: BranchRepository,
            branchMemberships: BranchMembershipRepository,
            clock: Clock,
          ) =>
            new AssignBranchMembershipUseCase(
              memberships,
              branches,
              branchMemberships,
              clock,
            ),
          inject: [
            MEMBERSHIP_REPOSITORY,
            BRANCH_REPOSITORY,
            BRANCH_MEMBERSHIP_REPOSITORY,
            CLOCK,
          ],
        },
        {
          provide: RemoveBranchMembershipUseCase,
          useFactory: (
            memberships: MembershipRepository,
            branches: BranchRepository,
            branchMemberships: BranchMembershipRepository,
          ) =>
            new RemoveBranchMembershipUseCase(
              memberships,
              branches,
              branchMemberships,
            ),
          inject: [
            MEMBERSHIP_REPOSITORY,
            BRANCH_REPOSITORY,
            BRANCH_MEMBERSHIP_REPOSITORY,
          ],
        },
        {
          provide: RegistrationConsumer,
          useFactory: (
            messaging: MessagingClient,
            ensureMembership: EnsureMembershipUseCase,
            logger: Logger,
          ) => new RegistrationConsumer(messaging, ensureMembership, logger),
          inject: [MessagingClient, EnsureMembershipUseCase, Logger],
        },
        InternalServiceGuard,
      ],
    };
  }
}
