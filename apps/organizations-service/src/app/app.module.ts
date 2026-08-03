import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { EVENT_PUBLISHER } from '../application/ports/event-publisher';
import type { OrganizationEventPublisher } from '../application/ports/event-publisher';
import {
  INVITATION_REPOSITORY,
  type InvitationRepository,
} from '../application/ports/invitation.repository';
import { MEMBERSHIP_REPOSITORY } from '../application/ports/membership.repository';
import {
  SUPPORT_TEAM_REPOSITORY,
  type SupportTeamRepository,
} from '../application/ports/support-team.repository';
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
import { AcceptInvitationUseCase } from '../application/use-cases/accept-invitation';
import { ChangeMembershipRoleUseCase } from '../application/use-cases/change-membership-role';
import { ChangeMembershipStatusUseCase } from '../application/use-cases/change-membership-status';
import { CreateBranchUseCase } from '../application/use-cases/create-branch';
import { CreateDepartmentUseCase } from '../application/use-cases/create-department';
import { CreateStationUseCase } from '../application/use-cases/create-station';
import { EnsureMembershipUseCase } from '../application/use-cases/ensure-membership';
import { GetMembershipUseCase } from '../application/use-cases/get-membership';
import { IssueInvitationUseCase } from '../application/use-cases/issue-invitation';
import { ListBranchStructureUseCase } from '../application/use-cases/list-branch-structure';
import {
  CreateSupportTeamUseCase,
  GetSupportTeamUseCase,
  ListSupportTeamsUseCase,
  SetSupportTeamMembersUseCase,
  SetSupportTeamScopeUseCase,
  UpdateSupportTeamUseCase,
} from '../application/use-cases/support-teams';
import { ListInvitationsUseCase } from '../application/use-cases/list-invitations';
import {
  GetMembershipBranchesUseCase,
  ListBranchesUseCase,
  SetMembershipBranchesUseCase,
} from '../application/use-cases/membership-branches';
import { PreviewInvitationUseCase } from '../application/use-cases/preview-invitation';
import { ResolveActiveMembershipUseCase } from '../application/use-cases/resolve-active-membership';
import { RevokeInvitationUseCase } from '../application/use-cases/revoke-invitation';
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
import { PrismaInvitationRepository } from '../infrastructure/prisma/prisma-invitation.repository';
import { PrismaMembershipRepository } from '../infrastructure/prisma/prisma-membership.repository';
import { PrismaOperationalStationRepository } from '../infrastructure/prisma/prisma-operational-station.repository';
import { PrismaOrganizationRepository } from '../infrastructure/prisma/prisma-organization.repository';
import { PrismaSupportTeamRepository } from '../infrastructure/prisma/prisma-support-team.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { UuidGenerator } from '../infrastructure/uuid-generator';
import { HealthController } from './health/health.controller';
import { InvitationsController } from './invitations/invitations.controller';
import { MembershipsController } from './memberships/memberships.controller';
import { SupportTeamsController } from './teams/teams.controller';
import {
  OrganizationStructureController,
  OrganizationStructureItemsController,
} from './structure/structure.controller';
import { InternalMembershipsController } from './internal/internal-memberships.controller';
import { InternalOrganizationMembershipsController } from './internal/internal-organization-memberships.controller';
import { InternalServiceGuard } from './internal/internal-service.guard';
import { RegistrationConsumer } from './messaging/registration.consumer';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 *
 * JwtModule is registered for VERIFICATION ONLY — this service never signs a
 * token. It gained a person-facing surface in Sprint 9.8 (ADR 0019), which
 * reversed the property the previous version of this comment described.
 *
 * JwtAccessGuard is a plain provider rather than an APP_GUARD, on purpose:
 * the /internal/* controllers authenticate a PROCESS through
 * InternalServiceGuard, and a global person-token guard would either lock
 * them out or have to be excepted per route. Each controller declares the
 * guard it means.
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
        JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
      ],
      controllers: [
        HealthController,
        InvitationsController,
        MembershipsController,
        SupportTeamsController,
        OrganizationStructureController,
        OrganizationStructureItemsController,
        InternalMembershipsController,
        InternalOrganizationMembershipsController,
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
          provide: INVITATION_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaInvitationRepository(prisma),
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
            teams: SupportTeamRepository,
          ) =>
            new ResolveActiveMembershipUseCase(
              memberships,
              organizations,
              branchMemberships,
              teams,
            ),
          inject: [
            MEMBERSHIP_REPOSITORY,
            ORGANIZATION_REPOSITORY,
            BRANCH_MEMBERSHIP_REPOSITORY,
            SUPPORT_TEAM_REPOSITORY,
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
          provide: SUPPORT_TEAM_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaSupportTeamRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: ListSupportTeamsUseCase,
          useFactory: (teams: SupportTeamRepository) =>
            new ListSupportTeamsUseCase(teams),
          inject: [SUPPORT_TEAM_REPOSITORY],
        },
        {
          provide: GetSupportTeamUseCase,
          useFactory: (
            teams: SupportTeamRepository,
            memberships: MembershipRepository,
          ) => new GetSupportTeamUseCase(teams, memberships),
          inject: [SUPPORT_TEAM_REPOSITORY, MEMBERSHIP_REPOSITORY],
        },
        {
          provide: CreateSupportTeamUseCase,
          useFactory: (
            teams: SupportTeamRepository,
            clock: Clock,
            ids: IdGenerator,
            events: OrganizationEventPublisher,
          ) => new CreateSupportTeamUseCase(teams, clock, ids, events),
          inject: [
            SUPPORT_TEAM_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
            EVENT_PUBLISHER,
          ],
        },
        {
          provide: UpdateSupportTeamUseCase,
          useFactory: (
            teams: SupportTeamRepository,
            clock: Clock,
            events: OrganizationEventPublisher,
          ) => new UpdateSupportTeamUseCase(teams, clock, events),
          inject: [SUPPORT_TEAM_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: SetSupportTeamMembersUseCase,
          useFactory: (
            teams: SupportTeamRepository,
            memberships: MembershipRepository,
            clock: Clock,
          ) => new SetSupportTeamMembersUseCase(teams, memberships, clock),
          inject: [SUPPORT_TEAM_REPOSITORY, MEMBERSHIP_REPOSITORY, CLOCK],
        },
        {
          provide: SetSupportTeamScopeUseCase,
          useFactory: (
            teams: SupportTeamRepository,
            branches: BranchRepository,
            clock: Clock,
            events: OrganizationEventPublisher,
          ) => new SetSupportTeamScopeUseCase(teams, branches, clock, events),
          inject: [
            SUPPORT_TEAM_REPOSITORY,
            BRANCH_REPOSITORY,
            CLOCK,
            EVENT_PUBLISHER,
          ],
        },
        {
          provide: ListBranchesUseCase,
          useFactory: (branches: BranchRepository) =>
            new ListBranchesUseCase(branches),
          inject: [BRANCH_REPOSITORY],
        },
        {
          provide: ListBranchStructureUseCase,
          useFactory: (
            branches: BranchRepository,
            departments: DepartmentRepository,
            stations: OperationalStationRepository,
            memberships: MembershipRepository,
          ) =>
            new ListBranchStructureUseCase(
              branches,
              departments,
              stations,
              memberships,
            ),
          inject: [
            BRANCH_REPOSITORY,
            DEPARTMENT_REPOSITORY,
            STATION_REPOSITORY,
            MEMBERSHIP_REPOSITORY,
          ],
        },
        {
          provide: GetMembershipBranchesUseCase,
          useFactory: (
            memberships: MembershipRepository,
            branchMemberships: BranchMembershipRepository,
          ) => new GetMembershipBranchesUseCase(memberships, branchMemberships),
          inject: [MEMBERSHIP_REPOSITORY, BRANCH_MEMBERSHIP_REPOSITORY],
        },
        {
          provide: SetMembershipBranchesUseCase,
          useFactory: (
            memberships: MembershipRepository,
            branches: BranchRepository,
            branchMemberships: BranchMembershipRepository,
            clock: Clock,
          ) =>
            new SetMembershipBranchesUseCase(
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
          provide: IssueInvitationUseCase,
          useFactory: (
            invitations: InvitationRepository,
            memberships: MembershipRepository,
            clock: Clock,
            ids: IdGenerator,
            events: OrganizationEventPublisher,
          ) =>
            new IssueInvitationUseCase(
              invitations,
              memberships,
              clock,
              ids,
              events,
            ),
          inject: [
            INVITATION_REPOSITORY,
            MEMBERSHIP_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
            EVENT_PUBLISHER,
          ],
        },
        {
          provide: ListInvitationsUseCase,
          useFactory: (invitations: InvitationRepository, clock: Clock) =>
            new ListInvitationsUseCase(invitations, clock),
          inject: [INVITATION_REPOSITORY, CLOCK],
        },
        {
          provide: PreviewInvitationUseCase,
          useFactory: (
            invitations: InvitationRepository,
            organizations: OrganizationRepository,
            clock: Clock,
          ) => new PreviewInvitationUseCase(invitations, organizations, clock),
          inject: [INVITATION_REPOSITORY, ORGANIZATION_REPOSITORY, CLOCK],
        },
        {
          provide: RevokeInvitationUseCase,
          useFactory: (
            invitations: InvitationRepository,
            clock: Clock,
            events: OrganizationEventPublisher,
          ) => new RevokeInvitationUseCase(invitations, clock, events),
          inject: [INVITATION_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: AcceptInvitationUseCase,
          useFactory: (
            invitations: InvitationRepository,
            memberships: MembershipRepository,
            organizations: OrganizationRepository,
            clock: Clock,
            ids: IdGenerator,
            events: OrganizationEventPublisher,
          ) =>
            new AcceptInvitationUseCase(
              invitations,
              memberships,
              organizations,
              clock,
              ids,
              events,
            ),
          inject: [
            INVITATION_REPOSITORY,
            MEMBERSHIP_REPOSITORY,
            ORGANIZATION_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
            EVENT_PUBLISHER,
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
        JwtAccessGuard,
      ],
    };
  }
}
