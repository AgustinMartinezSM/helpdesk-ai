import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { CLOCK, SystemClock, type Clock } from '../application/ports/clock';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../application/ports/event-publisher';
import {
  MEMBERSHIP_RESOLVER,
  type MembershipResolver,
} from '../application/ports/membership-resolver';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../application/ports/password-hasher';
import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
} from '../application/ports/refresh-token.repository';
import {
  TOKEN_ISSUER,
  type TokenIssuer,
} from '../application/ports/token-issuer';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../application/ports/user.repository';
import { SessionService } from '../application/session.service';
import { LoginUseCase } from '../application/use-cases/login';
import { LogoutUseCase } from '../application/use-cases/logout';
import { RefreshSessionUseCase } from '../application/use-cases/refresh-session';
import { RegisterUserUseCase } from '../application/use-cases/register-user';
import { APP_ENV, SERVICE_NAME, type AuthServiceEnv } from '../config/env';
import { HttpMembershipResolver } from '../infrastructure/http/http-membership-resolver';
import { RabbitMqEventPublisher } from '../infrastructure/messaging/rabbitmq-event-publisher';
import { PrismaRefreshTokenRepository } from '../infrastructure/prisma/prisma-refresh-token.repository';
import { PrismaUserRepository } from '../infrastructure/prisma/prisma-user.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { Argon2PasswordHasher } from '../infrastructure/security/argon2-password-hasher';
import { JwtTokenIssuer } from '../infrastructure/security/jwt-token-issuer';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import { AuthController } from './auth/auth.controller';
import { HealthController } from './health/health.controller';

/**
 * Root module built from an already-validated environment (see main.ts).
 *
 * Use cases and adapters are plain classes assembled here with factory
 * providers: the application and domain layers stay free of framework
 * decorators, and this module is the single place where ports meet their
 * infrastructure implementations.
 */
@Module({})
export class AppModule {
  static forRoot(env: AuthServiceEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: SERVICE_NAME,
          environment: env.NODE_ENV,
          logLevel: env.LOG_LEVEL,
        }),
        JwtModule.register({
          secret: env.JWT_ACCESS_SECRET,
          signOptions: {
            expiresIn: `${env.JWT_ACCESS_TTL_SECONDS}s`,
            issuer: 'helpdesk-ai/auth-service',
          },
        }),
        // Generous service-wide ceiling; credential endpoints declare much
        // tighter limits on the controller.
        ThrottlerModule.forRoot({
          throttlers: [{ ttl: 60_000, limit: 60 }],
        }),
      ],
      controllers: [HealthController, AuthController],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: USER_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaUserRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: REFRESH_TOKEN_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaRefreshTokenRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: TOKEN_ISSUER,
          useFactory: (jwt: JwtService) =>
            new JwtTokenIssuer(jwt, env.JWT_ACCESS_TTL_SECONDS),
          inject: [JwtService],
        },
        {
          // Absent when no service credential is configured: the resolver is
          // then null rather than a client that would call with nothing, and
          // tokens are minted without tenant claims.
          provide: MEMBERSHIP_RESOLVER,
          useFactory: (logger: Logger): MembershipResolver | null => {
            if (!env.INTERNAL_SERVICE_TOKEN) {
              logger.warn(
                'INTERNAL_SERVICE_TOKEN is not set: tokens will be minted without tenant claims',
              );
              return null;
            }
            return new HttpMembershipResolver(
              env.ORGANIZATIONS_SERVICE_URL,
              env.INTERNAL_SERVICE_TOKEN,
            );
          },
          inject: [Logger],
        },
        {
          provide: SessionService,
          useFactory: (
            refreshTokens: RefreshTokenRepository,
            tokenIssuer: TokenIssuer,
            clock: Clock,
            memberships: MembershipResolver | null,
            logger: Logger,
          ) =>
            new SessionService(
              refreshTokens,
              tokenIssuer,
              clock,
              env.JWT_REFRESH_TTL_SECONDS,
              memberships ?? undefined,
              logger,
            ),
          inject: [
            REFRESH_TOKEN_REPOSITORY,
            TOKEN_ISSUER,
            CLOCK,
            MEMBERSHIP_RESOLVER,
            Logger,
          ],
        },
        {
          // The adapter owns its broker connection; overriding this token in
          // tests keeps them broker-free.
          provide: EVENT_PUBLISHER,
          useFactory: (logger: Logger) =>
            new RabbitMqEventPublisher(
              new MessagingClient({
                url: env.RABBITMQ_URL,
                serviceName: SERVICE_NAME,
                logger,
              }),
              logger,
            ),
          inject: [Logger],
        },
        {
          provide: RegisterUserUseCase,
          useFactory: (
            users: UserRepository,
            hasher: PasswordHasher,
            clock: Clock,
            events: EventPublisher,
          ) => new RegisterUserUseCase(users, hasher, clock, events),
          inject: [USER_REPOSITORY, PASSWORD_HASHER, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: LoginUseCase,
          useFactory: (
            users: UserRepository,
            hasher: PasswordHasher,
            sessions: SessionService,
          ) => new LoginUseCase(users, hasher, sessions),
          inject: [USER_REPOSITORY, PASSWORD_HASHER, SessionService],
        },
        {
          provide: RefreshSessionUseCase,
          useFactory: (
            users: UserRepository,
            refreshTokens: RefreshTokenRepository,
            sessions: SessionService,
            clock: Clock,
          ) => new RefreshSessionUseCase(users, refreshTokens, sessions, clock),
          inject: [
            USER_REPOSITORY,
            REFRESH_TOKEN_REPOSITORY,
            SessionService,
            CLOCK,
          ],
        },
        {
          provide: LogoutUseCase,
          useFactory: (refreshTokens: RefreshTokenRepository, clock: Clock) =>
            new LogoutUseCase(refreshTokens, clock),
          inject: [REFRESH_TOKEN_REPOSITORY, CLOCK],
        },
        JwtAccessGuard,
      ],
    };
  }
}
