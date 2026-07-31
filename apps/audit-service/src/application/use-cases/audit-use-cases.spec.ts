import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import { ForbiddenAuditActionError } from '../../domain/errors';
import { FixedClock, InMemoryAuditEventRepository } from '../testing/fakes';
import { ListAuditEventsUseCase } from './list-audit-events';
import { RecordAuditEventUseCase } from './record-audit-event';

const ADMIN: Actor = {
  id: '44444444-4444-4444-8444-444444444444',
  roles: ['admin'],
  permissions: new Set([PERMISSIONS.AUDIT_READ]),
};
/** Agent-shaped grants: real workspace keys, none of them audit.read. */
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  roles: ['agent'],
  permissions: new Set([
    PERMISSIONS.TICKETS_READ_ALL,
    PERMISSIONS.TICKETS_NOTE_INTERNAL,
  ]),
};
const USER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['user'],
  permissions: new Set([PERMISSIONS.ORGANIZATION_READ]),
};

const ENVELOPE = {
  id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
  type: 'ticket.created.v1',
  occurredAt: '2026-07-28T12:00:00.000Z',
  correlationId: 'req-1',
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

describe('RecordAuditEventUseCase', () => {
  it('records an envelope verbatim with the recording timestamp', async () => {
    const ctx = buildContext();

    await ctx.record.execute(ENVELOPE);

    expect(ctx.events.events.get(ENVELOPE.id)).toEqual({
      id: ENVELOPE.id,
      type: 'ticket.created.v1',
      occurredAt: new Date('2026-07-28T12:00:00.000Z'),
      correlationId: 'req-1',
      payload: { ticketId: 'abc', anything: true },
      recordedAt: ctx.clock.now(),
    });
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
      type: 'some.future.event.v9',
      occurredAt: '2026-07-28T12:01:00.000Z',
      payload: null,
    });

    const stored = ctx.events.events.get(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(stored?.type).toBe('some.future.event.v9');
    expect(stored?.correlationId).toBeNull();
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

  it('filters by type and pages newest first', async () => {
    const ctx = buildContext();
    await ctx.record.execute(ENVELOPE);
    await ctx.record.execute({
      id: '00000000-0000-4000-8000-000000000002',
      type: 'user.registered.v1',
      occurredAt: '2026-07-28T12:02:00.000Z',
      payload: {},
    });

    const all = await ctx.list.execute(ADMIN, { limit: 50, offset: 0 });
    expect(all.map((event) => event.type)).toEqual([
      'user.registered.v1',
      'ticket.created.v1',
    ]);

    const filtered = await ctx.list.execute(ADMIN, {
      type: 'ticket.created.v1',
      limit: 50,
      offset: 0,
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(ENVELOPE.id);
  });
});
