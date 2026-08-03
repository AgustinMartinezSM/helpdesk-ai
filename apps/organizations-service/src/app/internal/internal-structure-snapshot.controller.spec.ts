/**
 * The three snapshot endpoints at the HTTP boundary (Sprint 9.16).
 *
 * Sprint 9.13 paid for the lesson this spec exists to apply: a use-case test
 * never crosses the exception filter, the validation pipe or the guard, so a
 * rule that is correct below the boundary can still be wrong above it. The
 * reconciliation specs cover everything downstream of "the snapshot answered".
 * What is only decided here is who may ask, how a page is requested, and what
 * a malformed request gets back.
 *
 * The repository is a fake that paginates the same way the Prisma one does, so
 * what these assertions pin is the CONTROLLER's half: that `after` and `limit`
 * reach the repository unchanged, that the default page size is applied when
 * the caller names none, that `nextCursor` round-trips, and that a bad cursor
 * never reaches the database at all. The SQL keyset walk itself is a separate
 * layer and has no database-level test — see this sprint's outcome record.
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
  BRANCH_MEMBERSHIP_REPOSITORY,
  BRANCH_REPOSITORY,
  DEPARTMENT_REPOSITORY,
  STATION_REPOSITORY,
} from '../../application/ports/structure.repository';
import {
  STRUCTURE_SNAPSHOT_REPOSITORY,
  type BranchSnapshotRow,
  type SnapshotPage,
  type StationSnapshotRow,
  type StructureSnapshotRepository,
  type TeamSnapshotRow,
} from '../../application/ports/structure-snapshot.repository';
import { SUPPORT_TEAM_REPOSITORY } from '../../application/ports/support-team.repository';
import {
  FakeOrganizationEventPublisher,
  InMemoryBranchMembershipRepository,
  InMemoryBranchRepository,
  InMemoryDepartmentRepository,
  InMemoryMembershipRepository,
  InMemoryOperationalStationRepository,
  InMemoryOrganizationRepository,
  InMemorySupportTeamRepository,
} from '../../application/testing/fakes';
import { permissionsForTemplate } from '../../domain/permissions';
import { organizationsServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';
import { INTERNAL_SERVICE_TOKEN_HEADER } from './internal-service.guard';

const INTERNAL_TOKEN = 'internal-test-token-0123456789abcdef0123456789';
const JWT_SECRET = 'jwt-test-secret-0123456789abcdef0123456789';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  INTERNAL_SERVICE_TOKEN: INTERNAL_TOKEN,
  JWT_ACCESS_SECRET: JWT_SECRET,
};

const ORG_A = '00000000-0000-4000-8000-00000000a001';
const ORG_B = '00000000-0000-4000-8000-00000000b001';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

/** Ids chosen so string order is reading order — the walk is by id. */
const BRANCH = {
  a1: '00000000-0000-4000-8000-0000000000b1',
  a2: '00000000-0000-4000-8000-0000000000b2',
  a3: '00000000-0000-4000-8000-0000000000b3',
  b4: '00000000-0000-4000-8000-0000000000b4',
  b5: '00000000-0000-4000-8000-0000000000b5',
};
const STATION_A = '00000000-0000-4000-8000-0000000000e1';
const STATION_B = '00000000-0000-4000-8000-0000000000e2';
const TEAM_A = '00000000-0000-4000-8000-0000000000f1';
const TEAM_B = '00000000-0000-4000-8000-0000000000f2';

const AT = new Date('2026-08-03T12:00:00.000Z');

interface RecordedCall {
  resource: 'branches' | 'stations' | 'teams';
  after: string | null;
  limit: number;
}

/**
 * Pages the way `PrismaStructureSnapshotRepository` does — filter by id
 * greater than the cursor, take the limit, report the last id as the next
 * cursor — and records what it was asked for, because the arguments are the
 * thing this spec is about.
 */
class RecordingSnapshotRepository implements StructureSnapshotRepository {
  branchRows: BranchSnapshotRow[] = [];
  stationRows: StationSnapshotRow[] = [];
  teamRows: TeamSnapshotRow[] = [];
  readonly calls: RecordedCall[] = [];

  async branches(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<BranchSnapshotRow>> {
    return this.page(
      'branches',
      this.branchRows,
      (row) => row.branchId,
      after,
      limit,
    );
  }

  async stations(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<StationSnapshotRow>> {
    return this.page(
      'stations',
      this.stationRows,
      (row) => row.stationId,
      after,
      limit,
    );
  }

  async teams(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<TeamSnapshotRow>> {
    return this.page('teams', this.teamRows, (row) => row.teamId, after, limit);
  }

  private page<T>(
    resource: RecordedCall['resource'],
    rows: T[],
    idOf: (row: T) => string,
    after: string | null,
    limit: number,
  ): SnapshotPage<T> {
    this.calls.push({ resource, after, limit });
    const ordered = [...rows].sort((a, b) => idOf(a).localeCompare(idOf(b)));
    const window = after ? ordered.filter((row) => idOf(row) > after) : ordered;
    const items = window.slice(0, limit);
    return {
      items,
      nextCursor:
        window.length > limit && items.length > 0
          ? idOf(items[items.length - 1])
          : null,
    };
  }
}

function branchRow(
  branchId: string,
  organizationId: string,
  code: string,
  name: string,
): BranchSnapshotRow {
  return {
    branchId,
    organizationId,
    code,
    name,
    status: 'active',
    updatedAt: AT,
  };
}

describe('Internal structure snapshot HTTP surface (fakes, real guard)', () => {
  let app: INestApplication;
  let adminToken: string;
  const snapshot = new RecordingSnapshotRepository();

  beforeAll(async () => {
    const env = validateEnv(organizationsServiceEnvSchema, TEST_ENV);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(STRUCTURE_SNAPSHOT_REPOSITORY)
      .useValue(snapshot)
      .overrideProvider(ORGANIZATION_REPOSITORY)
      .useValue(new InMemoryOrganizationRepository())
      .overrideProvider(MEMBERSHIP_REPOSITORY)
      .useValue(new InMemoryMembershipRepository())
      .overrideProvider(BRANCH_REPOSITORY)
      .useValue(new InMemoryBranchRepository())
      .overrideProvider(DEPARTMENT_REPOSITORY)
      .useValue(new InMemoryDepartmentRepository())
      .overrideProvider(STATION_REPOSITORY)
      .useValue(new InMemoryOperationalStationRepository())
      .overrideProvider(BRANCH_MEMBERSHIP_REPOSITORY)
      .useValue(new InMemoryBranchMembershipRepository())
      .overrideProvider(SUPPORT_TEAM_REPOSITORY)
      .useValue(new InMemorySupportTeamRepository())
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(new FakeOrganizationEventPublisher())
      // Keeps the suite broker-free: the real client owns a live AMQP
      // connection and the registration consumer subscribes on bootstrap.
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

    adminToken = await app.get(JwtService).signAsync(
      {
        email: 'admin@empresa.com',
        org: ORG_A,
        perms: [...permissionsForTemplate('organization_admin')],
      },
      { subject: ADMIN_ID },
    );
  });

  beforeEach(() => {
    snapshot.calls.length = 0;
    // Two tenants, and the first branch of each shares a code and a name.
    // Nothing in the request says which organization is being read, so the
    // rows themselves are the only thing keeping them apart.
    snapshot.branchRows = [
      branchRow(BRANCH.a1, ORG_A, 'central', 'Central'),
      branchRow(BRANCH.a2, ORG_A, 'norte', 'Norte'),
      branchRow(BRANCH.a3, ORG_A, 'sur', 'Sur'),
      branchRow(BRANCH.b4, ORG_B, 'central', 'Central'),
      branchRow(BRANCH.b5, ORG_B, 'oeste', 'Oeste'),
    ];
    snapshot.stationRows = [
      {
        stationId: STATION_A,
        branchId: BRANCH.a1,
        organizationId: ORG_A,
        code: 'caja-1',
        name: 'Caja 1',
        area: 'Ventas',
        status: 'active',
        updatedAt: AT,
      },
      {
        stationId: STATION_B,
        branchId: BRANCH.b4,
        organizationId: ORG_B,
        code: 'caja-1',
        name: 'Caja 1',
        area: null,
        status: 'archived',
        updatedAt: AT,
      },
    ];
    snapshot.teamRows = [
      {
        teamId: TEAM_A,
        organizationId: ORG_A,
        name: 'Mesa central',
        status: 'active',
        branchIds: [],
        updatedAt: AT,
      },
      {
        teamId: TEAM_B,
        organizationId: ORG_B,
        name: 'Soporte oeste',
        status: 'active',
        branchIds: [BRANCH.b4],
        updatedAt: AT,
      },
    ];
  });

  afterAll(async () => {
    await app.close();
  });

  function asService() {
    return { [INTERNAL_SERVICE_TOKEN_HEADER]: INTERNAL_TOKEN };
  }

  describe('who may ask', () => {
    it('refuses all three routes without the service credential', async () => {
      await request(app.getHttpServer())
        .get('/internal/structure/branches')
        .expect(401);
      await request(app.getHttpServer())
        .get('/internal/structure/stations')
        .expect(401);
      await request(app.getHttpServer())
        .get('/internal/structure/teams')
        .expect(401);

      // Refused before the repository, not after reading it.
      expect(snapshot.calls).toHaveLength(0);
    });

    it('refuses a wrong credential', async () => {
      await request(app.getHttpServer())
        .get('/internal/structure/branches')
        .set({ [INTERNAL_SERVICE_TOKEN_HEADER]: 'not-the-token' })
        .expect(401);
      expect(snapshot.calls).toHaveLength(0);
    });

    it("refuses a person's valid access token on all three routes", async () => {
      // The token is real and carries every organization permission — signed
      // with the secret this service verifies. It still opens nothing here:
      // these routes are guarded by the SERVICE credential alone, they are
      // absent from the api-gateway's routing table, and the gateway strips
      // x-internal-service-token from every inbound request. There is no
      // permission a browser could hold that would reach this data.
      for (const resource of ['branches', 'stations', 'teams']) {
        await request(app.getHttpServer())
          .get(`/internal/structure/${resource}`)
          .set({ authorization: `Bearer ${adminToken}` })
          .expect(401);
      }
      expect(snapshot.calls).toHaveLength(0);
    });

    it('accepts nothing but a read on these routes', async () => {
      // Read-only is a property of the surface, not just of the handler: with
      // the credential present and correct, a write verb answers 404 because
      // no such route was ever declared.
      await request(app.getHttpServer())
        .post('/internal/structure/branches')
        .set(asService())
        .send({ code: 'nuevo' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/internal/structure/branches/${BRANCH.a1}`)
        .set(asService())
        .expect(404);
    });
  });

  describe('keyset pagination', () => {
    it('walks the whole set a page at a time and ends with a null cursor', async () => {
      const first = await request(app.getHttpServer())
        .get('/internal/structure/branches?limit=2')
        .set(asService())
        .expect(200);
      expect(
        first.body.items.map((row: BranchSnapshotRow) => row.branchId),
      ).toEqual([BRANCH.a1, BRANCH.a2]);
      expect(first.body.nextCursor).toBe(BRANCH.a2);

      const second = await request(app.getHttpServer())
        .get(
          `/internal/structure/branches?limit=2&after=${first.body.nextCursor}`,
        )
        .set(asService())
        .expect(200);
      expect(
        second.body.items.map((row: BranchSnapshotRow) => row.branchId),
      ).toEqual([BRANCH.a3, BRANCH.b4]);

      const third = await request(app.getHttpServer())
        .get(
          `/internal/structure/branches?limit=2&after=${second.body.nextCursor}`,
        )
        .set(asService())
        .expect(200);
      expect(
        third.body.items.map((row: BranchSnapshotRow) => row.branchId),
      ).toEqual([BRANCH.b5]);
      // Null rather than the last id: this is what ends the caller's loop, and
      // a cursor on the final page would make the walk ask once more forever.
      expect(third.body.nextCursor).toBeNull();

      // The cursor and the limit reached the repository unchanged. Three
      // pages, three reads — the controller neither buffers nor re-reads.
      expect(snapshot.calls).toEqual([
        { resource: 'branches', after: null, limit: 2 },
        { resource: 'branches', after: BRANCH.a2, limit: 2 },
        { resource: 'branches', after: BRANCH.b4, limit: 2 },
      ]);
    });

    it('paginates stations and teams by the same rule', async () => {
      const stations = await request(app.getHttpServer())
        .get('/internal/structure/stations?limit=1')
        .set(asService())
        .expect(200);
      expect(stations.body.nextCursor).toBe(STATION_A);

      const teams = await request(app.getHttpServer())
        .get(`/internal/structure/teams?limit=1&after=${TEAM_A}`)
        .set(asService())
        .expect(200);
      expect(
        teams.body.items.map((row: TeamSnapshotRow) => row.teamId),
      ).toEqual([TEAM_B]);
      expect(teams.body.nextCursor).toBeNull();

      expect(snapshot.calls).toEqual([
        { resource: 'stations', after: null, limit: 1 },
        { resource: 'teams', after: TEAM_A, limit: 1 },
      ]);
    });

    it('applies the default page size when the caller names none', async () => {
      await request(app.getHttpServer())
        .get('/internal/structure/branches')
        .set(asService())
        .expect(200);
      // A caller that forgets the limit must not get one row or all of them.
      expect(snapshot.calls).toEqual([
        { resource: 'branches', after: null, limit: 200 },
      ]);
    });

    it('treats empty query values as absent rather than as a request', async () => {
      await request(app.getHttpServer())
        .get('/internal/structure/branches?after=&limit=')
        .set(asService())
        .expect(200);
      expect(snapshot.calls).toEqual([
        { resource: 'branches', after: null, limit: 200 },
      ]);
    });

    it('refuses a malformed cursor instead of restarting the walk', async () => {
      // Silently starting from the beginning would repeat work a resumed run
      // believed it had finished, and say nothing about it.
      await request(app.getHttpServer())
        .get('/internal/structure/branches?after=not-a-uuid')
        .set(asService())
        .expect(400);
      await request(app.getHttpServer())
        .get('/internal/structure/teams?after=1')
        .set(asService())
        .expect(400);
      expect(snapshot.calls).toHaveLength(0);
    });

    it('refuses a limit outside its bounds', async () => {
      for (const limit of ['0', '501', 'abc', '2.5', '-1']) {
        await request(app.getHttpServer())
          .get(`/internal/structure/branches?limit=${limit}`)
          .set(asService())
          .expect(400);
      }
      expect(snapshot.calls).toHaveLength(0);
    });
  });

  describe('what a row states', () => {
    it('carries each branch own organization, so two tenants can share a code', async () => {
      const response = await request(app.getHttpServer())
        .get('/internal/structure/branches')
        .set(asService())
        .expect(200);

      const central = response.body.items.filter(
        (row: BranchSnapshotRow) => row.code === 'central',
      );
      expect(central).toHaveLength(2);
      expect(
        central.map((row: BranchSnapshotRow) => row.organizationId).sort(),
      ).toEqual([ORG_A, ORG_B].sort());
      // The read is global on purpose — a consumer rebuilding a cold cache has
      // to learn about organizations it has never seen — so the tenant safety
      // is here, in the row, and nowhere else.
      for (const row of response.body.items) {
        expect(row.organizationId).toBeTruthy();
      }
    });

    it('states a station tenant even though the station has no column for it', async () => {
      const response = await request(app.getHttpServer())
        .get('/internal/structure/stations')
        .set(asService())
        .expect(200);

      expect(response.body.items).toEqual([
        {
          stationId: STATION_A,
          branchId: BRANCH.a1,
          organizationId: ORG_A,
          code: 'caja-1',
          name: 'Caja 1',
          area: 'Ventas',
          status: 'active',
          updatedAt: AT.toISOString(),
        },
        {
          stationId: STATION_B,
          branchId: BRANCH.b4,
          organizationId: ORG_B,
          code: 'caja-1',
          name: 'Caja 1',
          area: null,
          // Archived is ordinary state here: the consumer corrects a row it
          // missed the archival of through the same path that inserts one.
          status: 'archived',
          updatedAt: AT.toISOString(),
        },
      ]);
    });

    it('carries a team branch reach inline, empty meaning organization-wide', async () => {
      const response = await request(app.getHttpServer())
        .get('/internal/structure/teams')
        .set(asService())
        .expect(200);

      // The empty array travels as an empty array. Omitting it would let a
      // consumer read "unknown" where the domain says "every branch"
      // (ADR 0022), which is the one drift that hides work from the people
      // who should get it.
      expect(response.body.items[0].branchIds).toEqual([]);
      expect(response.body.items[1].branchIds).toEqual([BRANCH.b4]);
    });

    it('carries the source timestamp every row is applied under', async () => {
      const response = await request(app.getHttpServer())
        .get('/internal/structure/branches?limit=1')
        .set(asService())
        .expect(200);

      // Without it the consumer cannot decide whether a snapshot row is older
      // than the event it already applied, and the last-write-wins guard that
      // makes subscribe-then-reconcile safe has nothing to compare.
      expect(response.body.items[0].updatedAt).toBe(AT.toISOString());
    });
  });
});
