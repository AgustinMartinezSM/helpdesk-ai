import {
  ticketCreatedV1,
  ticketCreatedV2,
  userRegisteredV1,
} from './contracts.js';
import {
  buildEnvelope,
  decodeDelivery,
  decodeRawDelivery,
} from './messaging-client.js';

const ticketPayload = {
  ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
  requesterId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  title: 'Printer on fire',
  priority: 'high' as const,
  status: 'open' as const,
  createdAt: '2026-07-28T12:00:00.000Z',
};

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

const contractsByType = new Map([[ticketCreatedV1.type, ticketCreatedV1]]);

describe('buildEnvelope (producer-side guarantees)', () => {
  it('wraps a valid payload with id, type and timestamp', () => {
    const envelope = buildEnvelope(ticketCreatedV1, ticketPayload, {
      correlationId: 'req-123',
    });

    expect(envelope.type).toBe('ticket.created.v1');
    expect(envelope.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(envelope.occurredAt)).not.toBeNaN();
    expect(envelope.correlationId).toBe('req-123');
    expect(envelope.payload).toEqual(ticketPayload);
  });

  it('omits correlationId when the producer has none', () => {
    const envelope = buildEnvelope(ticketCreatedV1, ticketPayload);
    expect('correlationId' in envelope).toBe(false);
  });

  it('throws when the producer violates its own contract', () => {
    expect(() =>
      buildEnvelope(ticketCreatedV1, {
        ...ticketPayload,
        priority: 'catastrophic' as never,
      }),
    ).toThrow();
  });

  it('stamps the organization on the envelope, not the payload', () => {
    const envelope = buildEnvelope(ticketCreatedV2, ticketPayload, {
      correlationId: 'req-123',
      organizationId: ORGANIZATION_ID,
    });

    expect(envelope.organizationId).toBe(ORGANIZATION_ID);
    expect(envelope.payload).toEqual(ticketPayload);
    expect(envelope.payload).not.toHaveProperty('organizationId');
  });

  it('omits organizationId when the producer has none', () => {
    // Absent, not undefined — same shape as correlationId, so a consumer
    // reads "no tenant context" rather than "a tenant that is null".
    const envelope = buildEnvelope(ticketCreatedV2, ticketPayload);
    expect('organizationId' in envelope).toBe(false);
  });

  it('does not enforce a tenant on v2 — the caller must', () => {
    // buildEnvelope validates the payload and never the envelope, so an
    // org-less v2 would reach the bus silently. This pins that the guard
    // has to live at the publishing adapter, where the reason is known.
    expect(() => buildEnvelope(ticketCreatedV2, ticketPayload)).not.toThrow();
  });
});

describe('decodeDelivery (consumer-side guarantees)', () => {
  function deliveryOf(body: unknown): Buffer {
    return Buffer.from(JSON.stringify(body));
  }

  it('decodes a valid delivery into a typed event', () => {
    const envelope = buildEnvelope(ticketCreatedV1, ticketPayload);
    const decoded = decodeDelivery(deliveryOf(envelope), contractsByType);

    expect(decoded).toEqual({ ok: true, event: envelope });
  });

  it('rejects a body that is not JSON', () => {
    const decoded = decodeDelivery(Buffer.from('{"broken":'), contractsByType);
    expect(decoded).toEqual({ ok: false, reason: 'body is not valid JSON' });
  });

  it('rejects a JSON body that is not an envelope', () => {
    const decoded = decodeDelivery(
      deliveryOf({ hello: 'world' }),
      contractsByType,
    );
    expect(decoded).toEqual({
      ok: false,
      reason: 'envelope failed validation',
    });
  });

  it('rejects an event type with no bound contract', () => {
    const envelope = buildEnvelope(userRegisteredV1, {
      userId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
      email: 'ada@example.com',
      roles: ['user'],
      registeredAt: '2026-07-28T12:00:00.000Z',
    });
    const decoded = decodeDelivery(deliveryOf(envelope), contractsByType);

    expect(decoded).toEqual({
      ok: false,
      reason: 'no contract bound for type "user.registered.v1"',
    });
  });

  it('rejects a payload that violates the bound contract', () => {
    const envelope = {
      ...buildEnvelope(ticketCreatedV1, ticketPayload),
      payload: { ...ticketPayload, status: 'exploded' },
    };
    const decoded = decodeDelivery(deliveryOf(envelope), contractsByType);

    expect(decoded).toEqual({
      ok: false,
      reason: 'payload failed validation for "ticket.created.v1"',
    });
  });

  it('rejects a v2 delivery when only v1 is bound', () => {
    // The routing keys differ, so this should never be delivered in the
    // first place. This pins what happens if one ever is — by a hand-made
    // binding, a shovel, or a DLQ replay: it dead-letters rather than being
    // decoded as if it were the version the consumer understands.
    const envelope = buildEnvelope(ticketCreatedV2, ticketPayload, {
      organizationId: ORGANIZATION_ID,
    });
    const decoded = decodeDelivery(deliveryOf(envelope), contractsByType);

    expect(decoded).toEqual({
      ok: false,
      reason: 'no contract bound for type "ticket.created.v2"',
    });
  });
});

describe('decodeRawDelivery (firehose consumers)', () => {
  it('accepts a well-formed envelope whose type has no local contract', () => {
    const envelope = {
      id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      type: 'some.future.event.v9',
      occurredAt: '2026-07-28T12:00:00.000Z',
      payload: { anything: 'goes', nested: { deeply: true } },
    };

    const decoded = decodeRawDelivery(Buffer.from(JSON.stringify(envelope)));
    expect(decoded).toEqual({ ok: true, event: envelope });
  });

  it('still rejects non-JSON bodies and malformed envelopes', () => {
    expect(decodeRawDelivery(Buffer.from('{"broken":'))).toEqual({
      ok: false,
      reason: 'body is not valid JSON',
    });
    expect(
      decodeRawDelivery(Buffer.from(JSON.stringify({ hello: 'world' }))),
    ).toEqual({ ok: false, reason: 'envelope failed validation' });
  });

  it('preserves the organization id it does not understand the contract for', () => {
    // This is the whole reason the tenant is on the envelope. The audit
    // trail decodes every event through this function and has a schema for
    // none of them; if the field were not on eventEnvelopeSchema, zod would
    // strip it here and the tenant would never reach a database.
    const envelope = {
      id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      type: 'some.future.event.v9',
      occurredAt: '2026-07-28T12:00:00.000Z',
      correlationId: 'req-123',
      organizationId: ORGANIZATION_ID,
      payload: { anything: 'goes' },
    };

    const decoded = decodeRawDelivery(Buffer.from(JSON.stringify(envelope)));
    expect(decoded).toEqual({ ok: true, event: envelope });
  });
});
