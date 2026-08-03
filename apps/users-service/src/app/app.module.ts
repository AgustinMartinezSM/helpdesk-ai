import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import {
  FIELD_DEFINITION_REPOSITORY,
  type FieldDefinitionRepository,
} from '../application/ports/field-definition.repository';
import {
  FIELD_VALUE_REPOSITORY,
  type FieldValueRepository,
} from '../application/ports/field-value.repository';
import {
  MEMBERSHIP_PROJECTION_REPOSITORY,
  type MembershipProjectionRepository,
} from '../application/ports/membership-projection.repository';
import {
  PROFILE_EVENT_PUBLISHER,
  type ProfileEventPublisher,
} from '../application/ports/profile-event.publisher';
import {
  CLOCK,
  ID_GENERATOR,
  SystemClock,
  USER_PROFILE_REPOSITORY,
  type Clock,
  type IdGenerator,
  type UserProfileRepository,
} from '../application/ports/user-profile.repository';
import {
  ApplyMembershipCreatedUseCase,
  ApplyMembershipRoleChangedUseCase,
  ApplyMembershipStatusChangedUseCase,
} from '../application/use-cases/apply-membership-events';
import {
  CreateFieldDefinitionUseCase,
  ListFieldDefinitionsUseCase,
  UpdateFieldDefinitionUseCase,
} from '../application/use-cases/manage-field-definitions';
import {
  GetMyProfileUseCase,
  GetUserProfileUseCase,
  ListAssignableCandidatesUseCase,
  ListUserProfilesUseCase,
} from '../application/use-cases/profile-queries';
import { RegisterUserProfileUseCase } from '../application/use-cases/register-user-profile';
import {
  SetMemberFieldValueUseCase,
  SetMyFieldValueUseCase,
} from '../application/use-cases/set-field-value';
import {
  UpdateMemberPersonProfileUseCase,
  UpdateMyPersonProfileUseCase,
} from '../application/use-cases/update-person-profile';
import { APP_ENV, SERVICE_NAME, type UsersServiceEnv } from '../config/env';
import { RabbitMqProfileEventPublisher } from '../infrastructure/messaging/rabbitmq-profile-event.publisher';
import { PrismaFieldDefinitionRepository } from '../infrastructure/prisma/prisma-field-definition.repository';
import { PrismaFieldValueRepository } from '../infrastructure/prisma/prisma-field-value.repository';
import { PrismaMembershipProjectionRepository } from '../infrastructure/prisma/prisma-membership-projection.repository';
import { PrismaUserProfileRepository } from '../infrastructure/prisma/prisma-user-profile.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { UuidGenerator } from '../infrastructure/uuid-generator';
import { HealthController } from './health/health.controller';
import { MembershipEventsConsumer } from './messaging/membership-events.consumer';
import { RegistrationConsumer } from './messaging/registration.consumer';
import { UsersController } from './users/users.controller';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 */
@Module({})
export class AppModule {
  static forRoot(env: UsersServiceEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: SERVICE_NAME,
          environment: env.NODE_ENV,
          logLevel: env.LOG_LEVEL,
        }),
        // Verification only: this service never signs tokens.
        JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
      ],
      controllers: [HealthController, UsersController],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        { provide: ID_GENERATOR, useClass: UuidGenerator },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: USER_PROFILE_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaUserProfileRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: MEMBERSHIP_PROJECTION_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaMembershipProjectionRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: FIELD_DEFINITION_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaFieldDefinitionRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: FIELD_VALUE_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaFieldValueRepository(prisma),
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
          // Same shared client the consumers subscribe on; publishing is
          // best-effort log-and-swallow (ADR 0006).
          provide: PROFILE_EVENT_PUBLISHER,
          useFactory: (messaging: MessagingClient, logger: Logger) =>
            new RabbitMqProfileEventPublisher(messaging, logger),
          inject: [MessagingClient, Logger],
        },
        {
          provide: RegisterUserProfileUseCase,
          useFactory: (profiles: UserProfileRepository, clock: Clock) =>
            new RegisterUserProfileUseCase(profiles, clock),
          inject: [USER_PROFILE_REPOSITORY, CLOCK],
        },
        {
          provide: GetMyProfileUseCase,
          useFactory: (
            profiles: UserProfileRepository,
            definitions: FieldDefinitionRepository,
            values: FieldValueRepository,
          ) => new GetMyProfileUseCase(profiles, definitions, values),
          inject: [
            USER_PROFILE_REPOSITORY,
            FIELD_DEFINITION_REPOSITORY,
            FIELD_VALUE_REPOSITORY,
          ],
        },
        {
          provide: ListUserProfilesUseCase,
          useFactory: (
            profiles: UserProfileRepository,
            definitions: FieldDefinitionRepository,
            values: FieldValueRepository,
          ) => new ListUserProfilesUseCase(profiles, definitions, values),
          inject: [
            USER_PROFILE_REPOSITORY,
            FIELD_DEFINITION_REPOSITORY,
            FIELD_VALUE_REPOSITORY,
          ],
        },
        {
          // One dependency, and that is the point: a candidate list has no
          // business assembling organization-defined field values.
          provide: ListAssignableCandidatesUseCase,
          useFactory: (profiles: UserProfileRepository) =>
            new ListAssignableCandidatesUseCase(profiles),
          inject: [USER_PROFILE_REPOSITORY],
        },
        {
          provide: GetUserProfileUseCase,
          useFactory: (
            profiles: UserProfileRepository,
            definitions: FieldDefinitionRepository,
            values: FieldValueRepository,
          ) => new GetUserProfileUseCase(profiles, definitions, values),
          inject: [
            USER_PROFILE_REPOSITORY,
            FIELD_DEFINITION_REPOSITORY,
            FIELD_VALUE_REPOSITORY,
          ],
        },
        {
          provide: UpdateMyPersonProfileUseCase,
          useFactory: (
            profiles: UserProfileRepository,
            clock: Clock,
            events: ProfileEventPublisher,
          ) => new UpdateMyPersonProfileUseCase(profiles, clock, events),
          inject: [USER_PROFILE_REPOSITORY, CLOCK, PROFILE_EVENT_PUBLISHER],
        },
        {
          provide: UpdateMemberPersonProfileUseCase,
          useFactory: (
            profiles: UserProfileRepository,
            clock: Clock,
            events: ProfileEventPublisher,
          ) => new UpdateMemberPersonProfileUseCase(profiles, clock, events),
          inject: [USER_PROFILE_REPOSITORY, CLOCK, PROFILE_EVENT_PUBLISHER],
        },
        {
          provide: SetMyFieldValueUseCase,
          useFactory: (
            definitions: FieldDefinitionRepository,
            values: FieldValueRepository,
            clock: Clock,
            events: ProfileEventPublisher,
          ) => new SetMyFieldValueUseCase(definitions, values, clock, events),
          inject: [
            FIELD_DEFINITION_REPOSITORY,
            FIELD_VALUE_REPOSITORY,
            CLOCK,
            PROFILE_EVENT_PUBLISHER,
          ],
        },
        {
          provide: SetMemberFieldValueUseCase,
          useFactory: (
            profiles: UserProfileRepository,
            definitions: FieldDefinitionRepository,
            values: FieldValueRepository,
            clock: Clock,
            events: ProfileEventPublisher,
          ) =>
            new SetMemberFieldValueUseCase(
              profiles,
              definitions,
              values,
              clock,
              events,
            ),
          inject: [
            USER_PROFILE_REPOSITORY,
            FIELD_DEFINITION_REPOSITORY,
            FIELD_VALUE_REPOSITORY,
            CLOCK,
            PROFILE_EVENT_PUBLISHER,
          ],
        },
        {
          provide: CreateFieldDefinitionUseCase,
          useFactory: (
            definitions: FieldDefinitionRepository,
            clock: Clock,
            ids: IdGenerator,
          ) => new CreateFieldDefinitionUseCase(definitions, clock, ids),
          inject: [FIELD_DEFINITION_REPOSITORY, CLOCK, ID_GENERATOR],
        },
        {
          provide: UpdateFieldDefinitionUseCase,
          useFactory: (definitions: FieldDefinitionRepository, clock: Clock) =>
            new UpdateFieldDefinitionUseCase(definitions, clock),
          inject: [FIELD_DEFINITION_REPOSITORY, CLOCK],
        },
        {
          provide: ListFieldDefinitionsUseCase,
          useFactory: (definitions: FieldDefinitionRepository) =>
            new ListFieldDefinitionsUseCase(definitions),
          inject: [FIELD_DEFINITION_REPOSITORY],
        },
        {
          provide: ApplyMembershipCreatedUseCase,
          useFactory: (memberships: MembershipProjectionRepository) =>
            new ApplyMembershipCreatedUseCase(memberships),
          inject: [MEMBERSHIP_PROJECTION_REPOSITORY],
        },
        {
          provide: ApplyMembershipStatusChangedUseCase,
          useFactory: (memberships: MembershipProjectionRepository) =>
            new ApplyMembershipStatusChangedUseCase(memberships),
          inject: [MEMBERSHIP_PROJECTION_REPOSITORY],
        },
        {
          provide: ApplyMembershipRoleChangedUseCase,
          useFactory: (memberships: MembershipProjectionRepository) =>
            new ApplyMembershipRoleChangedUseCase(memberships),
          inject: [MEMBERSHIP_PROJECTION_REPOSITORY],
        },
        {
          provide: RegistrationConsumer,
          useFactory: (
            messaging: MessagingClient,
            registerProfile: RegisterUserProfileUseCase,
            logger: Logger,
          ) => new RegistrationConsumer(messaging, registerProfile, logger),
          inject: [MessagingClient, RegisterUserProfileUseCase, Logger],
        },
        {
          provide: MembershipEventsConsumer,
          useFactory: (
            messaging: MessagingClient,
            applyCreated: ApplyMembershipCreatedUseCase,
            applyStatusChanged: ApplyMembershipStatusChangedUseCase,
            applyRoleChanged: ApplyMembershipRoleChangedUseCase,
            logger: Logger,
          ) =>
            new MembershipEventsConsumer(
              messaging,
              applyCreated,
              applyStatusChanged,
              applyRoleChanged,
              logger,
            ),
          inject: [
            MessagingClient,
            ApplyMembershipCreatedUseCase,
            ApplyMembershipStatusChangedUseCase,
            ApplyMembershipRoleChangedUseCase,
            Logger,
          ],
        },
        JwtAccessGuard,
      ],
    };
  }
}
