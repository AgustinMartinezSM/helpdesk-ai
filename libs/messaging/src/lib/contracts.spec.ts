import {
  aiSuggestionCreatedV1,
  aiSuggestionCreatedV2,
  eventEnvelopeSchema,
  membershipCreatedV1,
  membershipStatusChangedV1,
  MissingTenantContextError,
  requireEnvelopeOrganization,
  ticketAssignedV1,
  ticketAssignedV2,
  ticketCommentAddedV1,
  ticketCommentAddedV2,
  ticketCreatedV1,
  ticketCreatedV2,
  ticketStatusChangedV1,
  ticketStatusChangedV2,
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

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

const validStatusChangedPayload = {
  ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
  actorId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  fromStatus: 'open',
  toStatus: 'in_progress',
  changedAt: '2026-07-28T12:00:00.000Z',
};

const validAssignedPayload = {
  ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
  actorId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  assigneeId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  assignedAt: '2026-07-28T12:00:00.000Z',
};

const validCommentPayload = {
  ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
  commentId: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
  authorId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  internal: false,
  addedAt: '2026-07-28T12:00:00.000Z',
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

  it('carries an organization id through, and still accepts one without', () => {
    // The field has to exist on this schema or zod strips it, and every
    // consumer — including the audit trail, whose only validation IS this
    // schema — would see a tenant-free envelope with nothing to explain it.
    const scoped = eventEnvelopeSchema.safeParse({
      ...validEnvelope,
      type: 'ticket.created.v2',
      organizationId: ORGANIZATION_ID,
    });
    expect(scoped.success).toBe(true);
    expect(scoped.data?.organizationId).toBe(ORGANIZATION_ID);

    // v1 envelopes have none, and must keep parsing. This is what "consumers
    // keep reading v1" means at the schema level.
    const unscoped = eventEnvelopeSchema.safeParse(validEnvelope);
    expect(unscoped.success).toBe(true);
    expect(unscoped.data?.organizationId).toBeUndefined();
  });

  it('rejects an organization id that is not a uuid', () => {
    expect(
      eventEnvelopeSchema.safeParse({
        ...validEnvelope,
        organizationId: 'bootstrap',
      }).success,
    ).toBe(false);
  });
});

describe('v2 contracts', () => {
  const PAIRS = [
    [ticketCreatedV1, ticketCreatedV2, validTicketPayload],
    [ticketStatusChangedV1, ticketStatusChangedV2, validStatusChangedPayload],
    [ticketAssignedV1, ticketAssignedV2, validAssignedPayload],
    [ticketCommentAddedV1, ticketCommentAddedV2, validCommentPayload],
    [aiSuggestionCreatedV1, aiSuggestionCreatedV2, validSuggestionPayload],
  ] as const;

  it.each(PAIRS)(
    'names %#: v2 is the v1 type with the suffix bumped',
    (v1, v2) => {
      expect(v2.type).toBe(v1.type.replace(/\.v1$/, '.v2'));
      expect(v2.type).not.toBe(v1.type);
    },
  );

  it.each(PAIRS)(
    'payload %#: v2 accepts exactly what v1 accepts',
    (v1, v2, payload) => {
      // Same schema object, so this cannot drift — the assertion exists to
      // fail loudly if someone later copies the schema instead of sharing it.
      expect(v2.payloadSchema).toBe(v1.payloadSchema);
      expect(v2.payloadSchema.safeParse(payload)).toEqual(
        v1.payloadSchema.safeParse(payload),
      );
    },
  );

  it('does not carry the tenant in the payload', () => {
    // The tenant rides the envelope. A payload field would be invisible to
    // any consumer that has no schema for the contract, and would be
    // stripped here anyway.
    const parsed = ticketCreatedV2.payloadSchema.safeParse({
      ...validTicketPayload,
      organizationId: ORGANIZATION_ID,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data).not.toHaveProperty('organizationId');
  });

  it('has no user.registered.v2', async () => {
    // Registration is anonymous and the membership that would supply a
    // tenant is created by consuming this very event, so a v2 could only
    // ever carry an absent tenant. Documented in messaging.md.
    const contracts = await import('./contracts.js');
    expect(Object.keys(contracts)).not.toContain('userRegisteredV2');
    expect(userRegisteredV1.type).toBe('user.registered.v1');
  });
});

describe('membership contracts', () => {
  const MEMBERSHIP_ID = '9d0c1b2a-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
  const USER_ID = '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111';

  const validCreatedPayload = {
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    roleTemplate: 'agent',
    status: 'active',
    createdAt: '2026-07-30T12:00:00.000Z',
  };

  const validStatusChangedPayload = {
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    fromStatus: 'active',
    toStatus: 'suspended',
    version: 2,
    changedAt: '2026-07-30T12:00:00.000Z',
  };

  it('accepts a valid membership.created.v1 payload', () => {
    expect(
      membershipCreatedV1.payloadSchema.safeParse(validCreatedPayload).success,
    ).toBe(true);
  });

  it('rejects a membership.created.v1 payload with an empty role template', () => {
    expect(
      membershipCreatedV1.payloadSchema.safeParse({
        ...validCreatedPayload,
        roleTemplate: '',
      }).success,
    ).toBe(false);
  });

  it('does not constrain the role template to a vocabulary', () => {
    // The vocabulary is deliberately unfrozen: it is an open decision in the
    // handoff, and an enum here would make settling it a breaking change.
    expect(
      membershipCreatedV1.payloadSchema.safeParse({
        ...validCreatedPayload,
        roleTemplate: 'a_template_invented_after_this_contract_shipped',
      }).success,
    ).toBe(true);
  });

  it('accepts a valid membership.status-changed.v1 payload', () => {
    expect(
      membershipStatusChangedV1.payloadSchema.safeParse(
        validStatusChangedPayload,
      ).success,
    ).toBe(true);
  });

  it.each([0, -1, 1.5])(
    'rejects a membership.status-changed.v1 payload with version %p',
    (version) => {
      // Versions start at 1 and only ever increment; anything else is a
      // publisher bug, not a state a consumer should have to interpret.
      expect(
        membershipStatusChangedV1.payloadSchema.safeParse({
          ...validStatusChangedPayload,
          version,
        }).success,
      ).toBe(false);
    },
  );
});

describe('requireEnvelopeOrganization', () => {
  const envelope = {
    id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
    type: 'membership.created.v1',
    occurredAt: '2026-07-30T12:00:00.000Z',
    payload: {},
  };

  it('returns the organization when the envelope carries one', () => {
    expect(
      requireEnvelopeOrganization({
        ...envelope,
        organizationId: ORGANIZATION_ID,
      }),
    ).toBe(ORGANIZATION_ID);
  });

  it('throws MissingTenantContextError when it is absent', () => {
    // Inside a subscribe handler this throw is what dead-letters the
    // delivery: a tenantless tenant-carrying event must become an
    // inspectable dead letter, never an unowned row.
    expect(() => requireEnvelopeOrganization(envelope)).toThrow(
      MissingTenantContextError,
    );
    expect(() => requireEnvelopeOrganization(envelope)).toThrow(
      'membership.created.v1',
    );
  });
});
