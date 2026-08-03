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
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const ADMIN_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '55555555-5555-4555-8555-555555555555';
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

/**
 * Reading, renaming and handing on an organization, over HTTP.
 *
 * Separate app instance from the creation suite above because these routes need
 * the opposite precondition — a token that DOES carry a tenant — and mixing the
 * two token sets in one fixture is how a test ends up proving the wrong thing.
 *
 * What is checked here and nowhere else: which status each refusal actually
 * arrives as. Every rule below is covered against the use case too, and Sprint
 * 9.13 shipped two refusals that were correct there and wrong above the
 * exception filter.
 */
describe('Organization identity HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const events = new FakeOrganizationEventPublisher();
  let ownerToken: string;
  let adminToken: string;
  let agentToken: string;
  let tenantlessToken: string;

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
    const sign = (
      userId: string,
      template: 'owner' | 'organization_admin' | 'agent',
    ) =>
      jwt.signAsync(
        {
          email: `${userId}@empresa.com`,
          org: REAL_ORG_ID,
          perms: [...permissionsForTemplate(template)],
        },
        { subject: userId },
      );

    // The owner's and the administrator's tokens are INDISTINGUISHABLE by
    // permissions — the two templates resolve to the same set — which is the
    // whole reason ownership is decided from the stored row.
    ownerToken = await sign(OWNER_ID, 'owner');
    adminToken = await sign(ADMIN_ID, 'organization_admin');
    agentToken = await sign(AGENT_ID, 'agent');
    tenantlessToken = await jwt.signAsync(
      {
        email: 'nowhere@empresa.com',
        perms: [...permissionsForTemplate('organization_admin')],
      },
      { subject: NEWCOMER_ID },
    );
  });

  beforeEach(() => {
    organizations.organizations.clear();
    organizations.memberships = memberships;
    memberships.memberships.length = 0;
    events.renamed.length = 0;
    events.roleChanged.length = 0;
    events.ownershipTransfers.length = 0;

    organizations.add({
      id: REAL_ORG_ID,
      slug: 'ferreteria-sur',
      name: 'Ferretería Sur',
      status: 'active',
      createdAt: AT,
      updatedAt: AT,
    });
    memberships.memberships.push(
      membership({
        id: 'm-owner',
        organizationId: REAL_ORG_ID,
        userId: OWNER_ID,
        roleTemplate: 'owner',
      }),
      membership({
        id: 'm-admin',
        organizationId: REAL_ORG_ID,
        userId: ADMIN_ID,
        roleTemplate: 'organization_admin',
      }),
      membership({
        id: 'm-agent',
        organizationId: REAL_ORG_ID,
        userId: AGENT_ID,
        roleTemplate: 'agent',
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /organizations/current', () => {
    it('answers the organization and that the owner owns it', async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations/current')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body).toEqual({
        organizationId: REAL_ORG_ID,
        slug: 'ferreteria-sur',
        name: 'Ferretería Sur',
        viewerIsOwner: true,
      });
    });

    it('tells an administrator with identical permissions that they do not', async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.viewerIsOwner).toBe(false);
    });

    it('answers 403 for a token carrying no organization', async () => {
      // NoOrganizationContextError, mapped by the shared filter. The route is
      // not reachable without a tenant, unlike POST /organizations.
      await request(app.getHttpServer())
        .get('/organizations/current')
        .set('Authorization', `Bearer ${tenantlessToken}`)
        .expect(403);
    });

    it('answers 401 unauthenticated', async () => {
      await request(app.getHttpServer())
        .get('/organizations/current')
        .expect(401);
    });
  });

  describe('PATCH /organizations/current', () => {
    it('renames and echoes the unchanged slug', async () => {
      const response = await request(app.getHttpServer())
        .patch('/organizations/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ferretería Sur S.R.L.' })
        .expect(200);

      expect(response.body).toEqual({
        organizationId: REAL_ORG_ID,
        slug: 'ferreteria-sur',
        name: 'Ferretería Sur S.R.L.',
      });
    });

    it('answers 403 for a member without organization.update', async () => {
      // The backend refusal, not a hidden control: the agent's own screen
      // never renders this form, and the route refuses them anyway.
      const response = await request(app.getHttpServer())
        .patch('/organizations/current')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ name: 'Mine now' })
        .expect(403);

      expect(response.body.message).toMatch(/not allowed/i);
      expect(organizations.organizations.get(REAL_ORG_ID)?.name).toBe(
        'Ferretería Sur',
      );
    });

    it('refuses a body that names a slug', async () => {
      // forbidNonWhitelisted is what makes this a 400 rather than a silently
      // ignored field — and a silently ignored field is how somebody would
      // conclude the slug is editable.
      await request(app.getHttpServer())
        .patch('/organizations/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ferretería Norte', slug: 'ferreteria-norte' })
        .expect(400);
    });

    it('refuses a body that names an organization', async () => {
      // The tenant comes from the token. No public route has taken an
      // organization id since Sprint 9.11.
      await request(app.getHttpServer())
        .patch('/organizations/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Ferretería Norte', organizationId: BOOTSTRAP_ID })
        .expect(400);
    });

    it.each([
      ['a missing name', {}],
      ['an empty name', { name: '' }],
      ['a name that is only whitespace', { name: '   ' }],
      ['a one-character name', { name: 'x' }],
      ['a name past the limit', { name: 'x'.repeat(200) }],
      ['a name that is not a string', { name: 42 }],
    ])('answers 400 for %s', async (_case, body) => {
      await request(app.getHttpServer())
        .patch('/organizations/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body)
        .expect(400);
    });

    it('answers 400 for a name whose LENGTH only passes before normalisation', async () => {
      // Eighty characters plus trailing spaces used to pass a check the stored
      // value would not match. The DTO normalises before validating.
      await request(app.getHttpServer())
        .patch('/organizations/current')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: ` x ` })
        .expect(400);
    });
  });

  describe('POST /organizations/ownership/transfer', () => {
    it('answers 200 and names both sides', async () => {
      const response = await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: ADMIN_ID })
        .expect(200);

      expect(response.body).toEqual({
        organizationId: REAL_ORG_ID,
        previousOwnerUserId: OWNER_ID,
        newOwnerUserId: ADMIN_ID,
        // The caller's OWN membership changed underneath them.
        sessionRefreshRequired: true,
      });
    });

    it('answers 403 for an administrator holding identical permissions', async () => {
      const response = await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: AGENT_ID })
        .expect(403);

      expect(response.body.message).toMatch(/owner/i);
      expect(await memberships.findOwner(REAL_ORG_ID)).toMatchObject({
        userId: OWNER_ID,
      });
    });

    it('refuses the former owner, whose token still says owner', async () => {
      // The stale-token case at the boundary, and the reason the rule reads
      // the row: the same bearer token that authorized the transfer a moment
      // ago would otherwise take the organization straight back.
      await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: AGENT_ID })
        .expect(200);

      await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: ADMIN_ID })
        .expect(403);

      expect(await memberships.findOwner(REAL_ORG_ID)).toMatchObject({
        userId: AGENT_ID,
      });
    });

    it('answers 409 when the owner names themselves', async () => {
      const response = await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: OWNER_ID })
        .expect(409);

      expect(response.body.message).toMatch(/already owns/i);
    });

    it.each(['invited', 'suspended', 'deactivated'] as const)(
      'answers 409 for a %s target',
      async (status) => {
        memberships.memberships.push(
          membership({
            id: 'm-inactive',
            organizationId: REAL_ORG_ID,
            userId: PLACED_ID,
            roleTemplate: 'agent',
            status,
          }),
        );

        await request(app.getHttpServer())
          .post('/organizations/ownership/transfer')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ userId: PLACED_ID })
          .expect(409);
      },
    );

    it('answers 404 for a member of another organization, exactly as for a stranger', async () => {
      // The tenant-isolation case at the boundary. Foreign and nonexistent
      // must be indistinguishable, or this endpoint becomes an oracle for
      // which user ids belong where.
      organizations.add({
        id: BOOTSTRAP_ID,
        slug: BOOTSTRAP_ORGANIZATION_SLUG,
        name: 'Bootstrap organization',
        status: 'active',
        createdAt: AT,
        updatedAt: AT,
      });
      memberships.memberships.push(
        membership({
          id: 'm-outsider',
          organizationId: BOOTSTRAP_ID,
          userId: PLACED_ID,
          roleTemplate: 'organization_admin',
        }),
      );

      const STRANGER_ID = '99999999-9999-4999-8999-999999999999';
      const foreign = await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: PLACED_ID })
        .expect(404);
      const stranger = await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: STRANGER_ID })
        .expect(404);

      // The two bodies differ in exactly one way: each echoes the id its own
      // caller sent. Substituting one for the other makes them identical, so
      // nothing in the response distinguishes "belongs to another tenant" from
      // "no such person" — which is the property, not the string.
      expect(foreign.body.error).toBe(stranger.body.error);
      expect(foreign.body.message.replace(PLACED_ID, STRANGER_ID)).toBe(
        stranger.body.message,
      );
      // And it says nothing about the organization the foreign member is
      // actually in.
      expect(foreign.body.message).not.toContain(BOOTSTRAP_ID);
    });

    it('answers 400 for a target that is not a uuid', async () => {
      await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: 'somebody' })
        .expect(400);
    });

    it('refuses a body that names an organization or a membership', async () => {
      await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: ADMIN_ID, organizationId: BOOTSTRAP_ID })
        .expect(400);
      await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: ADMIN_ID, membershipId: 'm-admin' })
        .expect(400);
    });

    it('answers 403 for a token carrying no organization', async () => {
      await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .set('Authorization', `Bearer ${tenantlessToken}`)
        .send({ userId: ADMIN_ID })
        .expect(403);
    });

    it('answers 401 unauthenticated', async () => {
      await request(app.getHttpServer())
        .post('/organizations/ownership/transfer')
        .send({ userId: ADMIN_ID })
        .expect(401);
    });
  });
});
