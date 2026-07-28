import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import {
  NOTIFICATION_REPOSITORY,
  TICKET_REF_REPOSITORY,
} from '../../application/ports/notification.repository';
import {
  NotifyStatusChangedUseCase,
  RegisterTicketRefUseCase,
} from '../../application/use-cases/project-ticket-events';
import {
  FixedClock,
  InMemoryNotificationRepository,
  InMemoryTicketRefRepository,
} from '../../application/testing/fakes';
import { notificationServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

const REQUESTER = '11111111-1111-4111-8111-111111111111';
const AGENT = '33333333-3333-4333-8333-333333333333';
const TICKET = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';

describe('Notifications HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let requesterToken: string;
  let agentToken: string;
  let notificationId: string;

  beforeAll(async () => {
    const env = validateEnv(notificationServiceEnvSchema, TEST_ENV);
    const refs = new InMemoryTicketRefRepository();
    const notifications = new InMemoryNotificationRepository();
    const clock = new FixedClock(new Date('2026-07-28T12:00:05.000Z'));

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(NOTIFICATION_REPOSITORY)
      .useValue(notifications)
      .overrideProvider(TICKET_REF_REPOSITORY)
      .useValue(refs)
      // Replacing the client keeps the suite broker-free: the real one owns
      // a live AMQP connection.
      .overrideProvider(MessagingClient)
      .useValue({
        subscribe: async () => undefined,
        close: async () => undefined,
      })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    const jwt = app.get(JwtService);
    requesterToken = await jwt.signAsync(
      { email: 'ada@example.com', roles: ['user'] },
      { subject: REQUESTER },
    );
    agentToken = await jwt.signAsync(
      { email: 'agent@example.com', roles: ['agent'] },
      { subject: AGENT },
    );

    // Seed one notification for the requester through the real policy.
    await new RegisterTicketRefUseCase(refs).execute({
      ticketId: TICKET,
      requesterId: REQUESTER,
    });
    const created = await new NotifyStatusChangedUseCase({
      refs,
      notifications,
      clock,
    }).execute({
      sourceEventId: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      ticketId: TICKET,
      actorId: AGENT,
      fromStatus: 'open',
      toStatus: 'in_progress',
    });
    notificationId = created!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/notifications/me').expect(401);
  });

  it('serves own notifications and validates the limit bound', async () => {
    const response = await request(app.getHttpServer())
      .get('/notifications/me')
      .set('authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: notificationId,
        type: 'ticket-status-changed',
        ticketId: TICKET,
        message: 'Your ticket moved from open to in_progress',
        readAt: null,
        createdAt: '2026-07-28T12:00:05.000Z',
      },
    ]);

    const empty = await request(app.getHttpServer())
      .get('/notifications/me')
      .set('authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(empty.body).toEqual([]);

    await request(app.getHttpServer())
      .get('/notifications/me?limit=100000')
      .set('authorization', `Bearer ${requesterToken}`)
      .expect(400);
  });

  it('marks own notifications read; foreign ids and non-uuids fail cleanly', async () => {
    await request(app.getHttpServer())
      .patch(`/notifications/${notificationId}/read`)
      .set('authorization', `Bearer ${agentToken}`)
      .expect(404);

    const read = await request(app.getHttpServer())
      .patch(`/notifications/${notificationId}/read`)
      .set('authorization', `Bearer ${requesterToken}`)
      .expect(200);
    expect(read.body.readAt).not.toBeNull();

    await request(app.getHttpServer())
      .patch('/notifications/not-a-uuid/read')
      .set('authorization', `Bearer ${requesterToken}`)
      .expect(400);
  });
});
