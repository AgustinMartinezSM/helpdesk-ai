import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { PERMISSIONS } from '@helpdesk-ai/security';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { MEMBERSHIP_VERIFIER } from '../../application/ports/membership-verifier';
import {
  BRANCH_REF_REPOSITORY,
  STATION_REF_REPOSITORY,
  TEAM_REF_REPOSITORY,
} from '../../application/ports/structure-refs.repository';
import { TICKET_REPOSITORY } from '../../application/ports/ticket.repository';
import {
  FakeEventPublisher,
  FakeMembershipVerifier,
  InMemoryBranchRefRepository,
  InMemoryStationRefRepository,
  InMemoryTeamRefRepository,
  InMemoryTicketRepository,
} from '../../application/testing/fakes';
import { ticketsServiceEnvSchema } from '../../config/env';
import {
  aBranchRef,
  aStationRef,
  OTHER_BRANCH,
  OTHER_ORGANIZATION,
  TEST_BRANCH,
  TEST_ORGANIZATION,
  TEST_STATION,
} from '../../testing/fixtures';
import { AppModule } from '../app.module';

/** An organization-wide support team: no branch rows, so it reaches every
 * ticket (ADR 0022). */
const CENTRAL_TEAM = '00000000-0000-4000-8000-0000000000c1';
/** Archived — one of the four reasons a team is unusable, all one 422. */
const ARCHIVED_TEAM = '00000000-0000-4000-8000-0000000000c9';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

describe('Tickets HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let userToken: string;
  let otherToken: string;
  let agentToken: string;
  let deskManagerToken: string;
  // Shared with the tests so they can add rows and simulate an outage.
  const memberships = new FakeMembershipVerifier();
  const branchRefs = new InMemoryBranchRefRepository();
  const stationRefs = new InMemoryStationRefRepository();
  const teamRefs = new InMemoryTeamRefRepository();

  beforeAll(async () => {
    const env = validateEnv(ticketsServiceEnvSchema, TEST_ENV);
    // The agent the suite assigns tickets to is a live member of the test
    // organization; anybody else is refused with the one generic 422.
    memberships.set(TEST_ORGANIZATION, '33333333-3333-4333-8333-333333333333');
    // One branch and one station at home, one foreign branch: enough to
    // prove the pickers and the create-time validation end to end.
    branchRefs.seed(aBranchRef());
    branchRefs.seed(
      aBranchRef({ id: OTHER_BRANCH, organizationId: OTHER_ORGANIZATION }),
    );
    stationRefs.seed(aStationRef());
    // One organization-wide team (no branch rows) and one archived: enough to
    // prove the routing route and the refusal it shares with every other
    // unusable team.
    teamRefs.seed({
      id: CENTRAL_TEAM,
      organizationId: TEST_ORGANIZATION,
      name: 'IT support',
      status: 'active',
      branchIds: [],
      updatedAt: new Date(),
    });
    teamRefs.seed({
      id: ARCHIVED_TEAM,
      organizationId: TEST_ORGANIZATION,
      name: 'Old desk',
      status: 'archived',
      branchIds: [],
      updatedAt: new Date(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(TICKET_REPOSITORY)
      .useValue(new InMemoryTicketRepository())
      // Replacing the adapter keeps the suite broker-free: the real one owns
      // a live AMQP connection.
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(new FakeEventPublisher())
      // Replacing the verifier keeps the suite offline: the real one calls
      // organizations-service over HTTP.
      .overrideProvider(MEMBERSHIP_VERIFIER)
      .useValue(memberships)
      // The structure projections back the pickers and the create-time
      // validation; in-memory doubles keep the suite database-free.
      .overrideProvider(BRANCH_REF_REPOSITORY)
      .useValue(branchRefs)
      .overrideProvider(STATION_REF_REPOSITORY)
      .useValue(stationRefs)
      .overrideProvider(TEAM_REF_REPOSITORY)
      .useValue(teamRefs)
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
    // The perms claim mirrors what auth-service mints per role template.
    const requesterPerms = [
      PERMISSIONS.TICKETS_CREATE,
      PERMISSIONS.TICKETS_READ_OWN,
      PERMISSIONS.TICKETS_REPLY_PUBLIC,
    ];
    const agentPerms = [
      PERMISSIONS.TICKETS_READ_ALL,
      PERMISSIONS.TICKETS_NOTE_INTERNAL,
      PERMISSIONS.TICKETS_CHANGE_STATUS,
      PERMISSIONS.TICKETS_ASSIGN_SELF,
      PERMISSIONS.TICKETS_ASSIGN_AGENT,
    ];
    userToken = await jwt.signAsync(
      {
        email: 'user@x.com',
        org: TEST_ORGANIZATION,
        perms: requesterPerms,
      },
      { subject: '11111111-1111-4111-8111-111111111111' },
    );
    otherToken = await jwt.signAsync(
      {
        email: 'other@x.com',
        org: TEST_ORGANIZATION,
        perms: requesterPerms,
      },
      { subject: '22222222-2222-4222-8222-222222222222' },
    );
    agentToken = await jwt.signAsync(
      {
        email: 'agent@x.com',
        org: TEST_ORGANIZATION,
        perms: agentPerms,
      },
      { subject: '33333333-3333-4333-8333-333333333333' },
    );
    // The service desk manager: routes work, and reads only what their teams
    // own plus their own requests. The `tm` claim is what carries the second
    // half — an absent claim would deny it (Sprint 9.12, D7).
    deskManagerToken = await jwt.signAsync(
      {
        email: 'desk@x.com',
        org: TEST_ORGANIZATION,
        perms: [
          PERMISSIONS.ROUTING_MANAGE,
          PERMISSIONS.TICKETS_READ_TEAM,
          PERMISSIONS.TICKETS_READ_OWN,
        ],
        tm: [CENTRAL_TEAM],
      },
      { subject: '44444444-4444-4444-8444-444444444444' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function asUser(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/tickets').expect(401);
    await request(app.getHttpServer())
      .get('/tickets')
      .set('authorization', 'Bearer forged')
      .expect(401);
  });

  it('runs the ticket lifecycle end to end over HTTP', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Broken printer', description: 'Paper jam forever' })
      .expect(201);
    const id = created.body.id;

    // Another requester cannot even learn the ticket exists.
    await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(otherToken))
      .expect(404);

    // Agent takes it, resolves it; requester confirms by closing.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/assignee`)
      .set(asUser(agentToken))
      .send({ assigneeId: '33333333-3333-4333-8333-333333333333' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(agentToken))
      .send({ status: 'in_progress' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(agentToken))
      .send({ status: 'resolved' })
      .expect(200);
    const closed = await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(userToken))
      .send({ status: 'closed' })
      .expect(200);
    expect(closed.body.status).toBe('closed');

    const details = await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(userToken))
      .expect(200);
    expect(
      details.body.history.map((h: { action: string }) => h.action),
    ).toEqual([
      'created',
      'assigned',
      'status_changed',
      'status_changed',
      'status_changed',
    ]);
  });

  it('enforces transition rules and staff-only actions', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'VPN drops', description: 'Every 5 minutes' })
      .expect(201);
    const id = created.body.id;

    // open -> resolved is not a legal move, even for staff.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(agentToken))
      .send({ status: 'resolved' })
      .expect(409);

    // Requesters cannot drive the lifecycle before resolution...
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(userToken))
      .send({ status: 'in_progress' })
      .expect(403);

    // ...nor assign, nor write internal notes.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/assignee`)
      .set(asUser(userToken))
      .send({ assigneeId: null })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/tickets/${id}/comments`)
      .set(asUser(userToken))
      .send({ body: 'sneaky note', internal: true })
      .expect(403);
  });

  it('verifies assignees against live membership over HTTP', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Screen flickers', description: 'Only on Mondays' })
      .expect(201);
    const id = created.body.id;

    // A verified member of the organization can hold the ticket.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/assignee`)
      .set(asUser(agentToken))
      .send({ assigneeId: '33333333-3333-4333-8333-333333333333' })
      .expect(200);

    // No membership row under this organization — a guessed id and a member
    // of another tenant produce this same answer. 422, not 404: the ticket
    // was found, the assignee is unusable.
    const refused = await request(app.getHttpServer())
      .patch(`/tickets/${id}/assignee`)
      .set(asUser(agentToken))
      .send({ assigneeId: '99999999-9999-4999-8999-999999999999' })
      .expect(422);
    expect(refused.body.message).toBe(
      'The assignee is not an active member who can hold tickets in this organization',
    );

    // Verification down is 503, not any 4xx: the request was fine and can
    // simply be retried.
    memberships.failure = new Error('connect ECONNREFUSED 127.0.0.1:3010');
    try {
      await request(app.getHttpServer())
        .patch(`/tickets/${id}/assignee`)
        .set(asUser(agentToken))
        .send({ assigneeId: '33333333-3333-4333-8333-333333333333' })
        .expect(503);
    } finally {
      memberships.failure = null;
    }
  });

  it('filters internal notes from requesters', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Slow laptop', description: 'Takes 10 min to boot' })
      .expect(201);
    const id = created.body.id;

    await request(app.getHttpServer())
      .post(`/tickets/${id}/comments`)
      .set(asUser(agentToken))
      .send({ body: 'user seems to have 400 tabs open', internal: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tickets/${id}/comments`)
      .set(asUser(agentToken))
      .send({ body: 'We are looking into it' })
      .expect(201);

    const forRequester = await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(userToken))
      .expect(200);
    expect(
      forRequester.body.comments.map((c: { body: string }) => c.body),
    ).toEqual(['We are looking into it']);

    const forAgent = await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(agentToken))
      .expect(200);
    expect(forAgent.body.comments).toHaveLength(2);
  });

  it('scopes listings to the requester and validates payloads', async () => {
    const mine = await request(app.getHttpServer())
      .get('/tickets')
      .set(asUser(userToken))
      .expect(200);
    for (const ticket of mine.body.items) {
      expect(ticket.requesterId).toBe('11111111-1111-4111-8111-111111111111');
    }

    await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'ab', description: 'too short title' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/tickets/not-a-uuid')
      .set(asUser(userToken))
      .expect(400);
  });

  it('serves the branch picker — the literal route wins over :id (Nest declaration order)', async () => {
    // If 'branches' were captured by @Get(':id'), the uuid pipe would answer
    // 400 here instead of the picker's 200 — this test is the route-order net.
    const branches = await request(app.getHttpServer())
      .get('/tickets/branches')
      .set(asUser(userToken))
      .expect(200);
    expect(branches.body).toEqual([
      expect.objectContaining({ id: TEST_BRANCH, code: 'BR-12' }),
    ]);

    const stations = await request(app.getHttpServer())
      .get(`/tickets/branches/${TEST_BRANCH}/stations`)
      .set(asUser(userToken))
      .expect(200);
    expect(stations.body).toEqual([
      expect.objectContaining({ id: TEST_STATION }),
    ]);

    // A foreign branch's stations answer 404, exactly like a missing one.
    await request(app.getHttpServer())
      .get(`/tickets/branches/${OTHER_BRANCH}/stations`)
      .set(asUser(userToken))
      .expect(404);
  });

  it('creates a located request, and refuses a foreign branch with the one generic 422', async () => {
    const located = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({
        title: 'Card terminal down',
        description: 'Cashier 2 cannot process payments since this morning.',
        branchId: TEST_BRANCH,
        stationId: TEST_STATION,
      })
      .expect(201);
    expect(located.body.branchId).toBe(TEST_BRANCH);
    expect(located.body.operationalStationId).toBe(TEST_STATION);

    await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({
        title: 'Card terminal down',
        description: 'Trying to plant another organization branch id here.',
        branchId: OTHER_BRANCH,
      })
      .expect(422);
  });

  it('routes a ticket to a support team and takes it back', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Payroll export fails', description: 'Every month end' })
      .expect(201);
    const id = created.body.id;

    const routed = await request(app.getHttpServer())
      .patch(`/tickets/${id}/team`)
      .set(asUser(deskManagerToken))
      .send({ teamId: CENTRAL_TEAM })
      .expect(200);
    expect(routed.body.assignedTeamId).toBe(CENTRAL_TEAM);

    // The move is in the history like every other change, under the existing
    // 'assigned' action — a fifth verb would be a contract change the audit
    // consumers never agreed to.
    const details = await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(deskManagerToken))
      .expect(200);
    expect(details.body.history.at(-1)).toEqual(
      expect.objectContaining({ action: 'assigned' }),
    );

    const cleared = await request(app.getHttpServer())
      .patch(`/tickets/${id}/team`)
      .set(asUser(deskManagerToken))
      .send({ teamId: null })
      .expect(200);
    expect(cleared.body.assignedTeamId).toBeNull();
  });

  it('refuses routing without routing.manage, and an unusable team with one 422', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Printer offline', description: 'Third floor' })
      .expect(201);
    const id = created.body.id;

    // The agent token holds assign_agent and read_all and still cannot route:
    // routing decides who SEES the ticket, so it is its own key.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/team`)
      .set(asUser(agentToken))
      .send({ teamId: CENTRAL_TEAM })
      .expect(403);

    // Archived, foreign and nonexistent are one answer on purpose — telling
    // them apart would make this route an oracle for another tenant's ids.
    for (const teamId of [
      ARCHIVED_TEAM,
      '00000000-0000-4000-8000-0000000000cf',
    ]) {
      await request(app.getHttpServer())
        .patch(`/tickets/${id}/team`)
        .set(asUser(deskManagerToken))
        .send({ teamId })
        .expect(422);
    }
  });

  it('accepts ?assignedTeamId= instead of answering 400 (9.13 D5)', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Scanner jams', description: 'Aisle 4' })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/tickets/${created.body.id}/team`)
      .set(asUser(deskManagerToken))
      .send({ teamId: CENTRAL_TEAM })
      .expect(200);

    // Sprint 9.12 taught the use case this filter and the DTO never declared
    // it, so `forbidNonWhitelisted` answered 400 to a supported input.
    const mine = await request(app.getHttpServer())
      .get(`/tickets?assignedTeamId=${CENTRAL_TEAM}`)
      .set(asUser(deskManagerToken))
      .expect(200);
    expect(mine.body.items.map((t: { id: string }) => t.id)).toContain(
      created.body.id,
    );

    // A team outside the caller's set is the empty page, never an error: a
    // 4xx would confirm the team exists.
    const foreign = await request(app.getHttpServer())
      .get('/tickets?assignedTeamId=00000000-0000-4000-8000-0000000000cf')
      .set(asUser(deskManagerToken))
      .expect(200);
    expect(foreign.body).toEqual({ items: [], total: 0 });

    await request(app.getHttpServer())
      .get('/tickets?assignedTeamId=not-a-uuid')
      .set(asUser(deskManagerToken))
      .expect(400);
  });
});
