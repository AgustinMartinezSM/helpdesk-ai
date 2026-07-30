import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
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
import { EnsureMembershipUseCase } from '../application/use-cases/ensure-membership';
import { ResolveActiveMembershipUseCase } from '../application/use-cases/resolve-active-membership';
import {
  APP_ENV,
  SERVICE_NAME,
  type OrganizationsServiceEnv,
} from '../config/env';
import { PrismaMembershipRepository } from '../infrastructure/prisma/prisma-membership.repository';
import { PrismaOrganizationRepository } from '../infrastructure/prisma/prisma-organization.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { UuidGenerator } from '../infrastructure/uuid-generator';
import { HealthController } from './health/health.controller';
import { InternalMembershipsController } from './internal/internal-memberships.controller';
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
      controllers: [HealthController, InternalMembershipsController],
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
          provide: EnsureMembershipUseCase,
          useFactory: (
            organizations: OrganizationRepository,
            memberships: MembershipRepository,
            clock: Clock,
            ids: IdGenerator,
          ) =>
            new EnsureMembershipUseCase(organizations, memberships, clock, ids),
          inject: [
            ORGANIZATION_REPOSITORY,
            MEMBERSHIP_REPOSITORY,
            CLOCK,
            ID_GENERATOR,
          ],
        },
        {
          provide: ResolveActiveMembershipUseCase,
          useFactory: (
            memberships: MembershipRepository,
            organizations: OrganizationRepository,
          ) => new ResolveActiveMembershipUseCase(memberships, organizations),
          inject: [MEMBERSHIP_REPOSITORY, ORGANIZATION_REPOSITORY],
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
