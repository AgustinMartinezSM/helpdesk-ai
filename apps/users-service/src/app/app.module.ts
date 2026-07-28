import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import {
  CLOCK,
  SystemClock,
  USER_PROFILE_REPOSITORY,
  type Clock,
  type UserProfileRepository,
} from '../application/ports/user-profile.repository';
import {
  GetMyProfileUseCase,
  ListUserProfilesUseCase,
} from '../application/use-cases/profile-queries';
import { RegisterUserProfileUseCase } from '../application/use-cases/register-user-profile';
import { APP_ENV, SERVICE_NAME, type UsersServiceEnv } from '../config/env';
import { PrismaUserProfileRepository } from '../infrastructure/prisma/prisma-user-profile.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { HealthController } from './health/health.controller';
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
          provide: RegisterUserProfileUseCase,
          useFactory: (profiles: UserProfileRepository, clock: Clock) =>
            new RegisterUserProfileUseCase(profiles, clock),
          inject: [USER_PROFILE_REPOSITORY, CLOCK],
        },
        {
          provide: GetMyProfileUseCase,
          useFactory: (profiles: UserProfileRepository) =>
            new GetMyProfileUseCase(profiles),
          inject: [USER_PROFILE_REPOSITORY],
        },
        {
          provide: ListUserProfilesUseCase,
          useFactory: (profiles: UserProfileRepository) =>
            new ListUserProfilesUseCase(profiles),
          inject: [USER_PROFILE_REPOSITORY],
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
        JwtAccessGuard,
      ],
    };
  }
}
