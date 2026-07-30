import {
  aiSuggestionCreatedV1,
  eventEnvelopeSchema,
  ticketCreatedV1,
  userRegisteredV1,
} from './contracts.js';

const validUserPayload = {
  userId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  email: 'ada@example.com',
  roles: ['user'],
  registeredAt: '2026-07-28T12:00:00.000Z',
};

const validTicketPayload = {
  ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
  requesterId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  title: 'Printer on fire',
  priority: 'high',
  status: 'open',
  createdAt: '2026-07-28T12:00:00.000Z',
};

const validSuggestionPayload = {
  suggestionId: '9b1f2c76-3f4d-4a55-9d21-0b3c5be2b333',
  ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
  task: 'summary',
  provider: 'local',
  model: 'heuristics-v1',
  requestedBy: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  createdAt: '2026-07-29T12:00:00.000Z',
};

describe('event contracts', () => {
  it('accepts a valid user.registered.v1 payload', () => {
    expect(
      userRegisteredV1.payloadSchema.safeParse(validUserPayload).success,
    ).toBe(true);
  });

  it('rejects a user.registered.v1 payload with a malformed email', () => {
    const result = userRegisteredV1.payloadSchema.safeParse({
      ...validUserPayload,
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a user.registered.v1 payload without roles', () => {
    const result = userRegisteredV1.payloadSchema.safeParse({
      ...validUserPayload,
      roles: [],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid ticket.created.v1 payload', () => {
    expect(
      ticketCreatedV1.payloadSchema.safeParse(validTicketPayload).success,
    ).toBe(true);
  });

  it('rejects a ticket.created.v1 payload with an unknown priority', () => {
    const result = ticketCreatedV1.payloadSchema.safeParse({
      ...validTicketPayload,
      priority: 'catastrophic',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid ai.suggestion.created.v1 payload', () => {
    expect(
      aiSuggestionCreatedV1.payloadSchema.safeParse(validSuggestionPayload)
        .success,
    ).toBe(true);
  });

  it('rejects an ai.suggestion.created.v1 payload with an unknown task', () => {
    const result = aiSuggestionCreatedV1.payloadSchema.safeParse({
      ...validSuggestionPayload,
      task: 'sentiment',
    });
    expect(result.success).toBe(false);
  });

  it('strips suggestion content from an ai.suggestion.created.v1 payload', () => {
    // The contract carries metadata only: a publisher that tries to attach
    // the draft must not be able to smuggle it past the schema.
    const result = aiSuggestionCreatedV1.payloadSchema.safeParse({
      ...validSuggestionPayload,
      output: { body: 'Hello, we are looking into it.' },
    });

    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty('output');
  });
});

describe('event envelope', () => {
  const validEnvelope = {
    id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
    type: 'ticket.created.v1',
    occurredAt: '2026-07-28T12:00:00.000Z',
    payload: validTicketPayload,
  };

  it('accepts a well-formed envelope, with or without correlation id', () => {
    expect(eventEnvelopeSchema.safeParse(validEnvelope).success).toBe(true);
    expect(
      eventEnvelopeSchema.safeParse({
        ...validEnvelope,
        correlationId: 'req-123',
      }).success,
    ).toBe(true);
  });

  it('rejects an envelope with a non-uuid id or malformed timestamp', () => {
    expect(
      eventEnvelopeSchema.safeParse({ ...validEnvelope, id: '42' }).success,
    ).toBe(false);
    expect(
      eventEnvelopeSchema.safeParse({
        ...validEnvelope,
        occurredAt: 'yesterday',
      }).success,
    ).toBe(false);
  });
});
