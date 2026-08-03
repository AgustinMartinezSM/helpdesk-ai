import {
  aiSuggestionCreatedV2,
  branchCreatedV1,
  branchUpdatedV1,
  eventEnvelopeSchema,
  invitationAcceptedV1,
  invitationIssuedV1,
  invitationRevokedV1,
  membershipCreatedV1,
  membershipRoleChangedV1,
  membershipStatusChangedV1,
  organizationOwnershipTransferredV1,
  organizationRenamedV1,
  profileUpdatedV1,
  MissingTenantContextError,
  requireEnvelopeOrganization,
  stationCreatedV1,
  stationUpdatedV1,
  ticketAssignedV2,
  ticketCommentAddedV2,
  ticketCreatedV2,
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

  it('accepts a valid ticket.created.v2 payload', () => {
    expect(
      ticketCreatedV2.payloadSchema.safeParse(validTicketPayload).success,
    ).toBe(true);
  });

  it('rejects a ticket.created.v2 payload with an unknown priority', () => {
    const result = ticketCreatedV2.payloadSchema.safeParse({
      ...validTicketPayload,
      priority: 'catastrophic',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid ai.suggestion.created.v2 payload', () => {
    expect(
      aiSuggestionCreatedV2.payloadSchema.safeParse(validSuggestionPayload)
        .success,
    ).toBe(true);
  });

  it('rejects an ai.suggestion.created.v2 payload with an unknown task', () => {
    const result = aiSuggestionCreatedV2.payloadSchema.safeParse({
      ...validSuggestionPayload,
      task: 'sentiment',
    });
    expect(result.success).toBe(false);
  });

  it('strips suggestion content from an ai.suggestion.created.v2 payload', () => {
    // The contract carries metadata only: a publisher that tries to attach
    // the draft must not be able to smuggle it past the schema.
    const result = aiSuggestionCreatedV2.payloadSchema.safeParse({
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

    // Legacy v1 envelopes have none, and must keep parsing: nothing
    // publishes them any more, but the audit firehose still records
    // third-party or replayed v1-typed events through this very schema.
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
  const CONTRACTS = [
    [ticketCreatedV2, 'ticket.created.v2', validTicketPayload],
    [
      ticketStatusChangedV2,
      'ticket.status-changed.v2',
      validStatusChangedPayload,
    ],
    [ticketAssignedV2, 'ticket.assigned.v2', validAssignedPayload],
    [ticketCommentAddedV2, 'ticket.comment-added.v2', validCommentPayload],
    [aiSuggestionCreatedV2, 'ai.suggestion.created.v2', validSuggestionPayload],
  ] as const;

  it.each(CONTRACTS)(
    'names %#: the .v2 suffix survives the deletion of v1',
    (contract, type) => {
      // v2 is the only published revision since phase 8, but the type string
      // keeps its suffix: renaming a contract in place is exactly what
      // ADR 0005 forbids. The suffix is history, not a parallel v1.
      expect(contract.type).toBe(type);
    },
  );

  it.each(CONTRACTS)(
    'payload %#: accepts the wire shape the dual-publish window carried',
    (contract, _type, payload) => {
      // The v1 twins shared these exact payload schemas until they were
      // deleted; the v2 schema still accepting the same shape is what makes
      // replaying an archived v1 payload against a v2 contract meaningful.
      expect(contract.payloadSchema.safeParse(payload).success).toBe(true);
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

  const validRoleChangedPayload = {
    membershipId: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    fromTemplate: 'requester',
    toTemplate: 'branch_manager',
    version: 2,
    changedAt: '2026-07-31T12:00:00.000Z',
  };

  it('accepts a valid membership.role-changed.v1 payload', () => {
    expect(
      membershipRoleChangedV1.payloadSchema.safeParse(validRoleChangedPayload)
        .success,
    ).toBe(true);
  });

  it('does not constrain either role template to a vocabulary', () => {
    // Same unfrozen vocabulary as membership.created.v1: an enum here would
    // make settling the template names a breaking contract change.
    expect(
      membershipRoleChangedV1.payloadSchema.safeParse({
        ...validRoleChangedPayload,
        toTemplate: 'a_template_invented_after_this_contract_shipped',
      }).success,
    ).toBe(true);
  });

  it.each(['fromTemplate', 'toTemplate'])(
    'rejects a membership.role-changed.v1 payload with an empty %s',
    (field) => {
      expect(
        membershipRoleChangedV1.payloadSchema.safeParse({
          ...validRoleChangedPayload,
          [field]: '',
        }).success,
      ).toBe(false);
    },
  );

  it.each([0, -1, 1.5])(
    'rejects a membership.role-changed.v1 payload with version %p',
    (version) => {
      expect(
        membershipRoleChangedV1.payloadSchema.safeParse({
          ...validRoleChangedPayload,
          version,
        }).success,
      ).toBe(false);
    },
  );
});

describe('organization contracts', () => {
  const OWNER = '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111';
  const SUCCESSOR = '3a0e4b45-ad2f-4d6b-9a79-2bf7b2d2b222';

  const RENAMED = {
    organizationId: ORGANIZATION_ID,
    slug: 'ferreteria-sur',
    previousName: 'Ferretería Sur',
    name: 'Ferretería Sur S.R.L.',
    renamedByUserId: OWNER,
    renamedAt: '2026-08-04T12:00:00.000Z',
  };

  const TRANSFERRED = {
    organizationId: ORGANIZATION_ID,
    transferredByUserId: OWNER,
    previousOwnerUserId: OWNER,
    newOwnerUserId: SUCCESSOR,
    newOwnerPreviousRoleTemplate: 'organization_admin',
    transferredAt: '2026-08-04T12:00:00.000Z',
  };

  it('accepts a valid organization.renamed.v1 payload', () => {
    expect(organizationRenamedV1.payloadSchema.safeParse(RENAMED).success).toBe(
      true,
    );
  });

  it('requires the slug, so the trail records that it did not move', () => {
    const { slug, ...withoutSlug } = RENAMED;
    expect(
      organizationRenamedV1.payloadSchema.safeParse(withoutSlug).success,
    ).toBe(false);
  });

  it('requires both names: a rename with one side missing says nothing', () => {
    expect(
      organizationRenamedV1.payloadSchema.safeParse({
        ...RENAMED,
        previousName: '',
      }).success,
    ).toBe(false);
  });

  it('requires the person who renamed it', () => {
    // Attribution is why these exist beside the membership contracts.
    const { renamedByUserId, ...anonymous } = RENAMED;
    expect(
      organizationRenamedV1.payloadSchema.safeParse(anonymous).success,
    ).toBe(false);
  });

  it('accepts a valid organization.ownership-transferred.v1 payload', () => {
    expect(
      organizationOwnershipTransferredV1.payloadSchema.safeParse(TRANSFERRED)
        .success,
    ).toBe(true);
  });

  it.each([
    'transferredByUserId',
    'previousOwnerUserId',
    'newOwnerUserId',
  ] as const)('requires %s on a transfer', (field) => {
    const payload = { ...TRANSFERRED };
    delete payload[field];
    expect(
      organizationOwnershipTransferredV1.payloadSchema.safeParse(payload)
        .success,
    ).toBe(false);
  });

  it('does not constrain the receiver’s previous template to a vocabulary', () => {
    // Same unfrozen vocabulary the membership contracts keep: an enum here
    // would make settling the template names a breaking contract change.
    expect(
      organizationOwnershipTransferredV1.payloadSchema.safeParse({
        ...TRANSFERRED,
        newOwnerPreviousRoleTemplate: 'invented_after_this_contract_shipped',
      }).success,
    ).toBe(true);
  });

  it('carries no membership ids, no email and no name of a person', () => {
    // The role-changed events already name the rows that moved. This one
    // records the decision, and zod strips anything an adapter tries to add —
    // audit keeps payloads opaquely and indefinitely.
    const parsed = organizationOwnershipTransferredV1.payloadSchema.parse({
      ...TRANSFERRED,
      previousOwnerEmail: 'titular@empresa.com',
      newOwnerName: 'Ada Lovelace',
      membershipId: '9d0c1b2a-3e4f-4a5b-8c6d-7e8f9a0b1c2d',
    } as never);
    expect(parsed).not.toHaveProperty('previousOwnerEmail');
    expect(parsed).not.toHaveProperty('newOwnerName');
    expect(parsed).not.toHaveProperty('membershipId');
  });
});

describe('branch and station contracts', () => {
  const BRANCH_ID = '3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const STATION_ID = '4b2c3d4e-5f6a-4b7c-8d8e-0f1a2b3c4d5e';

  const validBranchCreatedPayload = {
    branchId: BRANCH_ID,
    organizationId: ORGANIZATION_ID,
    code: 'store-12',
    name: 'Store 12',
    status: 'active',
    timezone: 'America/Argentina/Buenos_Aires',
    createdAt: '2026-07-31T12:00:00.000Z',
  };

  const validStationCreatedPayload = {
    stationId: STATION_ID,
    branchId: BRANCH_ID,
    organizationId: ORGANIZATION_ID,
    code: 'cashier-2',
    name: 'Cashier station 2',
    area: 'checkout',
    status: 'active',
    createdAt: '2026-07-31T12:00:00.000Z',
  };

  it('accepts a valid branch.created.v1 payload, with or without timezone', () => {
    expect(
      branchCreatedV1.payloadSchema.safeParse(validBranchCreatedPayload)
        .success,
    ).toBe(true);
    const { timezone, ...withoutTimezone } = validBranchCreatedPayload;
    expect(
      branchCreatedV1.payloadSchema.safeParse(withoutTimezone).success,
    ).toBe(true);
  });

  it('rejects a branch.created.v1 payload with an empty code', () => {
    expect(
      branchCreatedV1.payloadSchema.safeParse({
        ...validBranchCreatedPayload,
        code: '',
      }).success,
    ).toBe(false);
  });

  it('carries an archive as branch.updated.v1, not a lifecycle contract', () => {
    // One updated contract covers rename, status and timezone changes: an
    // archive IS an update to status, and consumers project last-write
    // state — a separate archived routing key would say nothing the payload
    // does not.
    const archived = branchUpdatedV1.payloadSchema.safeParse({
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
      code: 'store-12',
      name: 'Store 12',
      status: 'archived',
      updatedAt: '2026-07-31T13:00:00.000Z',
    });
    expect(branchUpdatedV1.type).toBe('branch.updated.v1');
    expect(archived.success).toBe(true);
  });

  it('does not constrain the status to a vocabulary', () => {
    // The place vocabulary is the owning service's internal concern; an enum
    // here would make renaming a status a breaking contract change.
    expect(
      branchUpdatedV1.payloadSchema.safeParse({
        ...validBranchCreatedPayload,
        createdAt: undefined,
        updatedAt: '2026-07-31T13:00:00.000Z',
        status: 'a_status_invented_after_this_contract_shipped',
      }).success,
    ).toBe(true);
  });

  it('accepts a valid station.created.v1 payload, with or without area', () => {
    expect(
      stationCreatedV1.payloadSchema.safeParse(validStationCreatedPayload)
        .success,
    ).toBe(true);
    const { area, ...withoutArea } = validStationCreatedPayload;
    expect(stationCreatedV1.payloadSchema.safeParse(withoutArea).success).toBe(
      true,
    );
  });

  it('rejects a station payload that loses its branch or organization', () => {
    // A station is context under a branch under a tenant; a consumer given
    // either id alone could not place the row.
    const { branchId, ...withoutBranch } = validStationCreatedPayload;
    expect(
      stationCreatedV1.payloadSchema.safeParse(withoutBranch).success,
    ).toBe(false);
    const { organizationId, ...withoutOrganization } =
      validStationCreatedPayload;
    expect(
      stationUpdatedV1.payloadSchema.safeParse({
        ...withoutOrganization,
        createdAt: undefined,
        updatedAt: '2026-07-31T13:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('accepts a valid station.updated.v1 payload', () => {
    const { createdAt, ...base } = validStationCreatedPayload;
    expect(
      stationUpdatedV1.payloadSchema.safeParse({
        ...base,
        status: 'archived',
        updatedAt: '2026-07-31T13:00:00.000Z',
      }).success,
    ).toBe(true);
  });
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

describe('profile.updated.v1', () => {
  it('accepts changed keys and rejects an empty change set', () => {
    expect(
      profileUpdatedV1.payloadSchema.safeParse({
        userId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
        changedKeys: ['phone', 'employee_number'],
        updatedAt: '2026-07-31T12:00:00.000Z',
      }).success,
    ).toBe(true);
    // An event announcing that nothing changed is a bug at the publisher.
    expect(
      profileUpdatedV1.payloadSchema.safeParse({
        userId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
        changedKeys: [],
        updatedAt: '2026-07-31T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('never carries values: the payload shape has no room for them', () => {
    const parsed = profileUpdatedV1.payloadSchema.parse({
      userId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
      changedKeys: ['phone'],
      updatedAt: '2026-07-31T12:00:00.000Z',
      phone: '+54 11 5555-5555',
    } as never);
    expect(parsed).not.toHaveProperty('phone');
  });
});

describe('invitation contracts', () => {
  const ISSUED = {
    invitationId: '8b1f2c3d-4e5a-4b6c-8d7e-9f0a1b2c3d4e',
    organizationId: 'c0ffee00-c0de-4bad-8f00-0d15ea5e0001',
    roleTemplate: 'agent',
    invitedByUserId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
    expiresAt: '2026-08-09T12:00:00.000Z',
    issuedAt: '2026-08-02T12:00:00.000Z',
  };

  it('accepts a valid invitation.issued.v1 payload', () => {
    expect(invitationIssuedV1.payloadSchema.safeParse(ISSUED).success).toBe(
      true,
    );
  });

  it('never carries the invited address or the code: the shapes have no room', () => {
    // The security property, pinned where it is enforced. zod strips what a
    // schema does not declare, so an adapter that started passing an address
    // would publish an event without one rather than leak it into the audit
    // trail's jsonb, where payloads are kept opaquely and indefinitely.
    const issued = invitationIssuedV1.payloadSchema.parse({
      ...ISSUED,
      inviteeEmail: 'nueva.persona@empresa.com',
      code: 'secret-code',
      codeHash: 'deadbeef',
    } as never);
    expect(issued).not.toHaveProperty('inviteeEmail');
    expect(issued).not.toHaveProperty('code');
    expect(issued).not.toHaveProperty('codeHash');

    const accepted = invitationAcceptedV1.payloadSchema.parse({
      invitationId: ISSUED.invitationId,
      organizationId: ISSUED.organizationId,
      acceptedByUserId: ISSUED.invitedByUserId,
      roleTemplate: 'agent',
      acceptedAt: '2026-08-03T12:00:00.000Z',
      inviteeEmail: 'nueva.persona@empresa.com',
    } as never);
    expect(accepted).not.toHaveProperty('inviteeEmail');
  });

  it('leaves membershipId optional, so a redemption that created no row can say so', () => {
    const withoutMembership = invitationAcceptedV1.payloadSchema.safeParse({
      invitationId: ISSUED.invitationId,
      organizationId: ISSUED.organizationId,
      acceptedByUserId: ISSUED.invitedByUserId,
      roleTemplate: 'agent',
      acceptedAt: '2026-08-03T12:00:00.000Z',
    });
    expect(withoutMembership.success).toBe(true);
  });

  it('does not constrain the role template to a vocabulary', () => {
    // Same reason as the membership contracts: the template vocabulary is
    // still open, and an enum here would make settling it a breaking change.
    expect(
      invitationIssuedV1.payloadSchema.safeParse({
        ...ISSUED,
        roleTemplate: 'a_template_that_does_not_exist_yet',
      }).success,
    ).toBe(true);
    expect(
      invitationIssuedV1.payloadSchema.safeParse({
        ...ISSUED,
        roleTemplate: '',
      }).success,
    ).toBe(false);
  });

  it('requires the revoker on invitation.revoked.v1', () => {
    // Attribution is the point of these events; an anonymous revoke would
    // record that the offer was pulled without recording who pulled it.
    expect(
      invitationRevokedV1.payloadSchema.safeParse({
        invitationId: ISSUED.invitationId,
        organizationId: ISSUED.organizationId,
        revokedAt: '2026-08-03T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
