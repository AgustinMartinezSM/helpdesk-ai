/**
 * Creating an organization, over HTTP, against the real JwtAccessGuard, the
 * real validation pipe and the real domain error filter.
 *
 * This suite exists because of the lesson Sprint 9.13 paid for: a use-case
 * test never crosses the exception filter, and two refusals that were correct
 * and covered below the boundary were wrong above it — a supported query
 * parameter answering 400 because the DTO never declared it, and a domain
 * error answering 500 because the filter had no arm for it. Both had shipped.
 *
 * So what is checked here is the HTTP contract: which status each refusal
 * arrives as, that the creator comes from the token rather than the body, and
 * that the route is reachable without a tenant. The rules themselves live
 * beside the use case.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { MEMBERSHIP_REPOSITORY } from '../../application/ports/membership.repository';
import { ORGANIZATION_REPOSITORY } from '../../application/ports/organization.repository';
import {
  FakeOrganizationEventPublisher,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
} from '../../application/testing/fakes';
import type { Membership } from '../../domain/membership';
import { BOOTSTRAP_ORGANIZATION_SLUG } from '../../domain/organization';
import { permissionsForTemplate } from '../../domain/permissions';
import { organizationsServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  INTERNAL_SERVICE_TOKEN: 'internal-test-token-0123456789abcdef0123456789',
  JWT_ACCESS_SECRET: 'jwt-test-secret-0123456789abcdef0123456789',
};

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const REAL_ORG_ID = '00000000-0000-4000-8000-0000000000ff';
const NEWCOMER_ID = '11111111-1111-4111-8111-111111111111';
const PLACED_ID = '22222222-2222-4222-8222-222222222222';
const AT = new Date('2026-08-01T12:00:00.000Z');

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    organizationId: BOOTSTRAP_ID,
    userId: NEWCOMER_ID,
    roleTemplate: 'requester',
    status: 'active',
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

describe('Organization creation HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const events = new FakeOrganizationEventPublisher();
  /** The token an account carries between registering and belonging anywhere. */
  let newcomerToken: string;
  let placedToken: string;

  beforeAll(async () => {
    const env = validateEnv(organizationsServiceEnvSchema, TEST_ENV);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(ORGANIZATION_REPOSITORY)
      .useValue(organizations)
      .overrideProvider(MEMBERSHIP_REPOSITORY)
      .useValue(memberships)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(events)
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
    const requesterPerms = [...permissionsForTemplate('requester')];
    // NO `org` claim: this is the state the route exists for.
    newcomerToken = await jwt.signAsync(
      { email: 'new@empresa.com', perms: requesterPerms },
      { subject: NEWCOMER_ID },
    );
    placedToken = await jwt.signAsync(
      { email: 'placed@empresa.com', org: REAL_ORG_ID, perms: requesterPerms },
      { subject: PLACED_ID },
    );
  });

  beforeEach(() => {
    organizations.organizations.clear();
    organizations.memberships = memberships;
    memberships.memberships.length = 0;
    events.created.length = 0;
    organizations.add({
      id: BOOTSTRAP_ID,
      slug: BOOTSTRAP_ORGANIZATION_SLUG,
      name: 'Bootstrap organization',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an organization for somebody who belongs nowhere real', async () => {
    memberships.memberships.push(membership());

    const response = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${newcomerToken}`)
      .send({ name: 'Ferretería Sur' })
      .expect(201);

    expect(response.body.slug).toBe('ferreteria-sur');
    expect(response.body.name).toBe('Ferretería Sur');
    // The token that made this request does not carry the new organization,
    // so the browser has to refresh the session before the person is inside
    // it. Saying so in the response is what /join learned in 9.9.
    expect(response.body.sessionRefreshRequired).toBe(true);
  });

  it('reaches the route with no tenant claim at all', async () => {
    // The whole point: this is the one place besides invitation acceptance
    // where a caller without an organization must NOT meet requireOrganization.
    memberships.memberships.push(membership());

    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${newcomerToken}`)
      .send({ name: 'Anywhere' })
      .expect(201);
  });

  it('answers 409 when the caller already belongs to a real organization', async () => {
    organizations.add({
      id: REAL_ORG_ID,
      slug: 'acme',
      name: 'Acme',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
    });
    memberships.memberships.push(
      membership({
        id: 'm-real',
        organizationId: REAL_ORG_ID,
        userId: PLACED_ID,
      }),
    );

    const response = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${placedToken}`)
      .send({ name: 'Second' })
      .expect(409);

    // The message has to be actionable: a refusal somebody cannot act on
    // reads as a bug, and this one is a platform limit they should be told
    // about rather than left to guess at.
    expect(response.body.message).toMatch(/already belong/i);
  });

  it('takes the creator from the token and refuses a body that names one', async () => {
    // `forbidNonWhitelisted` is what makes this a 400 rather than a silently
    // ignored field — and a silently ignored field is how somebody would
    // conclude the parameter works.
    memberships.memberships.push(membership());

    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${newcomerToken}`)
      .send({ name: 'Ferretería Sur', userId: PLACED_ID })
      .expect(400);
  });

  it('refuses a caller-supplied slug', async () => {
    // Not a convenience the DTO forgot: a chosen slug that could be refused
    // for being taken would answer "does an organization by this name
    // exist?" across tenants.
    memberships.memberships.push(membership());

    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${newcomerToken}`)
      .send({ name: 'Ferretería Sur', slug: 'whatever-i-want' })
      .expect(400);
  });

  it.each([
    ['a missing name', {}],
    ['an empty name', { name: '' }],
    ['a one-character name', { name: 'x' }],
    ['a name past the limit', { name: 'x'.repeat(200) }],
    ['a name that is not a string', { name: 42 }],
  ])('answers 400 for %s', async (_case, body) => {
    memberships.memberships.push(membership());

    await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${newcomerToken}`)
      .send(body)
      .expect(400);
  });

  it('refuses an unauthenticated caller', async () => {
    await request(app.getHttpServer())
      .post('/organizations')
      .send({ name: 'Ferretería Sur' })
      .expect(401);
  });
});
