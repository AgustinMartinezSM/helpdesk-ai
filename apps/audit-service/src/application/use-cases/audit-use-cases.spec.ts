import { MissingTenantContextError } from '@helpdesk-ai/messaging';
import {
  NoOrganizationContextError,
  PERMISSIONS,
  type Actor,
} from '@helpdesk-ai/security';
import { ForbiddenAuditActionError } from '../../domain/errors';
import { FixedClock, InMemoryAuditEventRepository } from '../testing/fakes';
import { ListAuditEventsUseCase } from './list-audit-events';
import {
  isTenantCarryingEventType,
  RecordAuditEventUseCase,
} from './record-audit-event';

/** The bootstrap organization, matching the id the migrations backfill to. */
const TEST_ORGANIZATION = '00000000-0000-4000-8000-000000000001';
/**
 * A second tenant, for the only isolation assertions that matter: that a
 * listing scoped to one organization does not return the other's rows.
 */
const OTHER_ORGANIZATION = '00000000-0000-4000-8000-0000000000ff';

const ADMIN: Actor = {
  id: '44444444-4444-4444-8444-444444444444',
  roles: ['admin'],
  organizationId: TEST_ORGANIZATION,
  permissions: new Set([PERMISSIONS.AUDIT_READ]),
};
/** Same grant, no tenant: the state between registering and belonging. */
const ADMIN_WITHOUT_ORG: Actor = {
  id: '55555555-5555-4555-8555-555555555555',
  roles: ['admin'],
  permissions: new Set([PERMISSIONS.AUDIT_READ]),
};
/** Agent-shaped grants: real workspace keys, none of them audit.read. */
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  roles: ['agent'],
  organizationId: TEST_ORGANIZATION,
  permissions: new Set([
    PERMISSIONS.TICKETS_READ_ALL,
    PERMISSIONS.TICKETS_NOTE_INTERNAL,
  ]),
};
const USER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['user'],
  organizationId: TEST_ORGANIZATION,
  permissions: new Set([PERMISSIONS.ORGANIZATION_READ]),
};

const ENVELOPE = {
  id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
  type: 'ticket.created.v1',
  occurredAt: '2026-07-28T12:00:00.000Z',
  correlationId: 'req-1',
  payload: { ticketId: 'abc', anything: true },
};

const ENVELOPE_V2 = {
  id: '8d2f1c8f-5e3a-4c8f-9b4f-0b2c3d4e5f6a',
  type: 'ticket.created.v2',
  occurredAt: '2026-07-28T12:00:01.000Z',
  correlationId: 'req-1',
  organizationId: TEST_ORGANIZATION,
  payload: { ticketId: 'abc', anything: true },
};

function buildContext() {
  const events = new InMemoryAuditEventRepository();
  const clock = new FixedClock(new Date('2026-07-28T12:00:05.000Z'));
  return {
    events,
    clock,
    record: new RecordAuditEventUseCase(events, clock),
    list: new ListAuditEventsUseCase(events),
  };
}

describe('isTenantCarryingEventType', () => {
  it('exempts v1 contracts: they predate the tenant on the envelope', () => {
    expect(isTenantCarryingEventType('ticket.created.v1')).toBe(false);
    expect(isTenantCarryingEventType('user.registered.v1')).toBe(false);
  });

  it('covers v2 and every later version', () => {
    expect(isTenantCarryingEventType('ticket.created.v2')).toBe(true);
    expect(isTenantCarryingEventType('some.future.event.v9')).toBe(true);
  });

  it('covers membership.* at v1: born tenant-carrying', () => {
    expect(isTenantCarryingEventType('membership.created.v1')).toBe(true);
    expect(isTenantCarryingEventType('membership.status-changed.v1')).toBe(
      true,
    );
  });

  it('leaves unversioned types out of the rule', () => {
    expect(isTenantCarryingEventType('wormhole.opened')).toBe(false);
  });
});

describe('RecordAuditEventUseCase', () => {
  it('records an envelope verbatim with the recording timestamp', async () => {
    const ctx = buildContext();

    await ctx.record.execute(ENVELOPE);

    expect(ctx.events.events.get(ENVELOPE.id)).toEqual({
      id: ENVELOPE.id,
      type: 'ticket.created.v1',
      occurredAt: new Date('2026-07-28T12:00:00.000Z'),
      correlationId: 'req-1',
      // Null archives the compatibility window as it happened: a v1
      // envelope had nowhere to carry a tenant.
      organizationId: null,
      payload: { ticketId: 'abc', anything: true },
      recordedAt: ctx.clock.now(),
    });
  });

  it('persists the tenant a v2 envelope carries', async () => {
    const ctx = buildContext();

    await ctx.record.execute(ENVELOPE_V2);

    expect(ctx.events.events.get(ENVELOPE_V2.id)?.organizationId).toBe(
      TEST_ORGANIZATION,
    );
  });

  it('rejects a tenantless v2 envelope without recording it', async () => {
    const ctx = buildContext();

    await expect(
      ctx.record.execute({ ...ENVELOPE_V2, organizationId: undefined }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
    // The throw is what dead-letters the delivery; nothing may land first.
    expect(ctx.events.events.size).toBe(0);
  });

  it('rejects a tenantless membership.*.v1 envelope: born tenant-carrying', async () => {
    const ctx = buildContext();

    await expect(
      ctx.record.execute({
        id: '00000000-0000-4000-8000-000000000009',
        type: 'membership.created.v1',
        occurredAt: '2026-07-28T12:00:00.000Z',
        payload: {},
      }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
    expect(ctx.events.events.size).toBe(0);
  });

  it('collapses redelivery into the first recording', async () => {
    const ctx = buildContext();
    await ctx.record.execute(ENVELOPE);
    const first = ctx.events.events.get(ENVELOPE.id);

    ctx.clock.advanceSeconds(60);
    await ctx.record.execute({ ...ENVELOPE, correlationId: 'req-2' });

    expect(ctx.events.events.size).toBe(1);
    expect(ctx.events.events.get(ENVELOPE.id)).toEqual(first);
  });

  it('records events with no correlation id and unknown types', async () => {
    const ctx = buildContext();
    await ctx.record.execute({
      id: '00000000-0000-4000-8000-000000000001',
      // v9 is tenant-carrying by the version half of the rule, so even an
      // unknown type must bring its tenant along.
      type: 'some.future.event.v9',
      occurredAt: '2026-07-28T12:01:00.000Z',
      organizationId: TEST_ORGANIZATION,
      payload: null,
    });

    const stored = ctx.events.events.get(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(stored?.type).toBe('some.future.event.v9');
    expect(stored?.correlationId).toBeNull();
    expect(stored?.organizationId).toBe(TEST_ORGANIZATION);
  });
});

describe('ListAuditEventsUseCase', () => {
  it('requires audit.read: agents and plain users are rejected', async () => {
    const ctx = buildContext();

    await expect(
      ctx.list.execute(AGENT, { limit: 50, offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenAuditActionError);
    await expect(
      ctx.list.execute(USER, { limit: 50, offset: 0 }),
    ).rejects.toBeInstanceOf(ForbiddenAuditActionError);
  });

  it('requires a tenant even with audit.read granted', async () => {
    const ctx = buildContext();

    await expect(
      ctx.list.execute(ADMIN_WITHOUT_ORG, { limit: 50, offset: 0 }),
    ).rejects.toBeInstanceOf(NoOrganizationContextError);
  });

  it('never returns rows from another organization, checked by identity', async () => {
    const ctx = buildContext();
    await ctx.record.execute(ENVELOPE_V2);
    const foreign = await ctx.record.execute({
      id: '00000000-0000-4000-8000-00000000000f',
      type: 'ticket.created.v2',
      occurredAt: '2026-07-28T12:03:00.000Z',
      organizationId: OTHER_ORGANIZATION,
      payload: { ticketId: 'not-yours' },
    });

    const listed = await ctx.list.execute(ADMIN, { limit: 50, offset: 0 });

    // By identity, not by count: a count assertion would keep passing if the
    // foreign row displaced a local one.
    expect(listed.map((event) => event.id)).toEqual([ENVELOPE_V2.id]);
    expect(listed.map((event) => event.id)).not.toContain(foreign.id);
  });

  it('hides v1-era rows (null tenant) until the operator backfill', async () => {
    const ctx = buildContext();
    await ctx.record.execute(ENVELOPE);

    const listed = await ctx.list.execute(ADMIN, { limit: 50, offset: 0 });

    expect(listed).toEqual([]);
  });

  it('filters by type and pages newest first', async () => {
    const ctx = buildContext();
    await ctx.record.execute(ENVELOPE_V2);
    await ctx.record.execute({
      id: '00000000-0000-4000-8000-000000000002',
      type: 'ticket.status-changed.v2',
      occurredAt: '2026-07-28T12:02:00.000Z',
      organizationId: TEST_ORGANIZATION,
      payload: {},
    });

    const all = await ctx.list.execute(ADMIN, { limit: 50, offset: 0 });
    expect(all.map((event) => event.type)).toEqual([
      'ticket.status-changed.v2',
      'ticket.created.v2',
    ]);

    const filtered = await ctx.list.execute(ADMIN, {
      type: 'ticket.created.v2',
      limit: 50,
      offset: 0,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(ENVELOPE_V2.id);
  });
});
