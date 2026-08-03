import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  DuplicatePendingInvitationError,
  ForbiddenInvitationActionError,
  InvalidRoleTemplateError,
  InvitationAddresseeMismatchError,
  InvitationNotFoundError,
  InvitationNotRedeemableError,
  MembershipNotFoundError,
  RoleTemplateNotGrantableError,
} from '../../domain/errors';
import { INVITATION_TTL_HOURS } from '../../domain/invitation';
import type { Membership, RoleTemplate } from '../../domain/membership';
import type { Organization } from '../../domain/organization';
import { permissionsForTemplate } from '../../domain/permissions';
import {
  FakeOrganizationEventPublisher,
  FixedClock,
  InMemoryInvitationRepository,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  SequentialIdGenerator,
} from '../testing/fakes';
import { AcceptInvitationUseCase } from './accept-invitation';
import { IssueInvitationUseCase } from './issue-invitation';
import { ListInvitationsUseCase } from './list-invitations';
import { PreviewInvitationUseCase } from './preview-invitation';
import { RevokeInvitationUseCase } from './revoke-invitation';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEWCOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-08-02T12:00:00.000Z');

function organization(
  id: string,
  slug: string,
  status = 'active',
): Organization {
  return {
    id,
    slug,
    name: slug,
    status: status as Organization['status'],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function membership(
  id: string,
  organizationId: string,
  userId: string,
  roleTemplate: RoleTemplate,
  status: Membership['status'] = 'active',
): Membership {
  return {
    id,
    organizationId,
    userId,
    roleTemplate,
    status,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function actor(
  id: string,
  organizationId: string | undefined,
  template: RoleTemplate | 'none',
): Actor {
  return {
    id,
    organizationId,
    permissions:
      template === 'none'
        ? new Set<string>()
        : new Set(permissionsForTemplate(template)),
  };
}

interface Harness {
  invitations: InMemoryInvitationRepository;
  memberships: InMemoryMembershipRepository;
  organizations: InMemoryOrganizationRepository;
  clock: FixedClock;
  events: FakeOrganizationEventPublisher;
  issue: IssueInvitationUseCase;
  list: ListInvitationsUseCase;
  revoke: RevokeInvitationUseCase;
  accept: AcceptInvitationUseCase;
}

function harness(): Harness {
  const invitations = new InMemoryInvitationRepository();
  const memberships = new InMemoryMembershipRepository();
  const organizations = new InMemoryOrganizationRepository();
  const clock = new FixedClock(NOW);
  const events = new FakeOrganizationEventPublisher();
  const ids = new SequentialIdGenerator();

  // The real redeem writes both tables in one transaction; sharing the array
  // keeps the fakes from disagreeing about whether a membership exists.
  invitations.memberships = memberships.memberships;

  organizations.add(organization(ORG_A, 'chain-a'));
  organizations.add(organization(ORG_B, 'chain-b'));
  memberships.memberships.push(
    membership('m-a', ORG_A, ADMIN_A, 'organization_admin'),
    membership('m-b', ORG_B, ADMIN_B, 'organization_admin'),
  );

  return {
    invitations,
    memberships,
    organizations,
    clock,
    events,
    issue: new IssueInvitationUseCase(
      invitations,
      memberships,
      clock,
      ids,
      events,
    ),
    list: new ListInvitationsUseCase(invitations, clock),
    revoke: new RevokeInvitationUseCase(invitations, clock, events),
    accept: new AcceptInvitationUseCase(
      invitations,
      memberships,
      organizations,
      clock,
      ids,
      events,
    ),
  };
}

describe('issuing an invitation', () => {
  it('returns the code exactly once and stores only its hash', async () => {
    const h = harness();

    const issued = await h.issue.execute(
      actor(ADMIN_A, ORG_A, 'organization_admin'),
      { inviteeEmail: 'Nueva.Persona@Empresa.com', roleTemplate: 'agent' },
    );

    expect(issued.code).toContain('.');
    expect(issued.code.split('.')[0]).toBe(issued.invitation.id);

    const stored = h.invitations.invitations[0];
    // The secret half must appear nowhere in the row.
    expect(JSON.stringify(stored)).not.toContain(issued.code.split('.')[1]);
    expect(stored.codeHash).toMatch(/^[0-9a-f]{64}$/);
    // Normalized for matching, so a differently-cased sign-in still redeems.
    expect(stored.inviteeEmail).toBe('nueva.persona@empresa.com');
    expect(stored.expiresAt.getTime()).toBe(
      NOW.getTime() + INVITATION_TTL_HOURS * 3_600_000,
    );
  });

  // That the address and the code never reach the BUS is pinned where it is
  // actually enforced — the payload schemas in @helpdesk-ai/messaging, which
  // strip what they do not declare. Here we only pin that the issue is
  // announced and names who did it.
  it('announces the issue and names the issuer', async () => {
    const h = harness();

    await h.issue.execute(actor(ADMIN_A, ORG_A, 'organization_admin'), {
      inviteeEmail: 'nueva.persona@empresa.com',
      roleTemplate: 'agent',
    });

    expect(h.events.invitationsIssued).toHaveLength(1);
    expect(h.events.invitationsIssued[0].invitation.invitedByUserId).toBe(
      ADMIN_A,
    );
  });

  it('refuses a caller without people.invite', async () => {
    const h = harness();

    await expect(
      h.issue.execute(actor(ADMIN_A, ORG_A, 'agent'), {
        inviteeEmail: 'x@empresa.com',
        roleTemplate: 'requester',
      }),
    ).rejects.toBeInstanceOf(ForbiddenInvitationActionError);
  });

  it('refuses owner outright, even though the subset check would allow it', async () => {
    const h = harness();
    // The premise this guards: the two templates resolve to the same set, so
    // a subset test alone cannot stop an admin minting a peer at the top.
    expect([...permissionsForTemplate('owner')].sort()).toEqual(
      [...permissionsForTemplate('organization_admin')].sort(),
    );

    await expect(
      h.issue.execute(actor(ADMIN_A, ORG_A, 'organization_admin'), {
        inviteeEmail: 'x@empresa.com',
        roleTemplate: 'owner',
      }),
    ).rejects.toBeInstanceOf(InvalidRoleTemplateError);
  });

  it('refuses a template the issuer could not exercise themselves', async () => {
    const h = harness();
    h.memberships.memberships.push(
      membership(
        'm-bm',
        ORG_A,
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'branch_manager',
      ),
    );

    await expect(
      h.issue.execute(
        {
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          organizationId: ORG_A,
          // A token that claims people.invite the stored template does not
          // carry — the shape a demoted admin still holds for 15 minutes.
          permissions: new Set([
            ...permissionsForTemplate('branch_manager'),
            PERMISSIONS.PEOPLE_INVITE,
          ]),
        },
        { inviteeEmail: 'x@empresa.com', roleTemplate: 'organization_admin' },
      ),
    ).rejects.toBeInstanceOf(RoleTemplateNotGrantableError);
  });

  it('reads the ceiling from the stored row, not the token', async () => {
    const h = harness();
    // The row says suspended; the token still says organization_admin.
    h.memberships.memberships[0] = membership(
      'm-a',
      ORG_A,
      ADMIN_A,
      'organization_admin',
      'suspended',
    );

    await expect(
      h.issue.execute(actor(ADMIN_A, ORG_A, 'organization_admin'), {
        inviteeEmail: 'x@empresa.com',
        roleTemplate: 'agent',
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it('refuses a second pending invitation for the same address', async () => {
    const h = harness();
    const issuer = actor(ADMIN_A, ORG_A, 'organization_admin');
    await h.issue.execute(issuer, {
      inviteeEmail: 'x@empresa.com',
      roleTemplate: 'agent',
    });

    await expect(
      h.issue.execute(issuer, {
        inviteeEmail: 'X@Empresa.com',
        roleTemplate: 'requester',
      }),
    ).rejects.toBeInstanceOf(DuplicatePendingInvitationError);
  });

  it('allows re-inviting once the previous invitation is settled', async () => {
    const h = harness();
    const issuer = actor(ADMIN_A, ORG_A, 'organization_admin');
    const first = await h.issue.execute(issuer, {
      inviteeEmail: 'x@empresa.com',
      roleTemplate: 'agent',
    });
    await h.revoke.execute(issuer, first.invitation.id);

    await expect(
      h.issue.execute(issuer, {
        inviteeEmail: 'x@empresa.com',
        roleTemplate: 'agent',
      }),
    ).resolves.toBeDefined();
  });
});

describe('accepting an invitation', () => {
  async function issued(h: Harness, email = 'nueva@empresa.com') {
    return h.issue.execute(actor(ADMIN_A, ORG_A, 'organization_admin'), {
      inviteeEmail: email,
      roleTemplate: 'agent',
    });
  }

  it('creates the membership and announces both facts', async () => {
    const h = harness();
    const invitation = await issued(h);

    const accepted = await h.accept.execute(
      actor(NEWCOMER, undefined, 'none'),
      { code: invitation.code, actorEmail: 'Nueva@Empresa.com' },
    );

    expect(accepted.membershipCreated).toBe(true);
    expect(accepted.membership.organizationId).toBe(ORG_A);
    expect(accepted.membership.roleTemplate).toBe('agent');
    expect(h.events.created).toHaveLength(1);
    expect(h.events.invitationsAccepted[0].membershipId).toBe(
      accepted.membership.id,
    );
  });

  it('needs no permission and no organization on the token', async () => {
    const h = harness();
    const invitation = await issued(h);

    // The redeemer's token carries an empty permission set and no tenant —
    // the belongs-nowhere state every newly registered account is in.
    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).resolves.toBeDefined();
  });

  it('is not an oracle: unknown id and wrong secret answer alike', async () => {
    const h = harness();
    const invitation = await issued(h);
    const [id, secret] = invitation.code.split('.');

    const wrongSecret = h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
      code: `${id}.${'z'.repeat(secret.length)}`,
      actorEmail: 'nueva@empresa.com',
    });
    const unknownId = h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
      code: `99999999-9999-4999-8999-999999999999.${secret}`,
      actorEmail: 'nueva@empresa.com',
    });
    const malformed = h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
      code: 'not-a-code',
      actorEmail: 'nueva@empresa.com',
    });

    await expect(wrongSecret).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(unknownId).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(malformed).rejects.toBeInstanceOf(InvitationNotFoundError);
  });

  it('refuses a redeemer who is not the addressee', async () => {
    const h = harness();
    const invitation = await issued(h);

    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'alguien.otro@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationAddresseeMismatchError);
  });

  it('can only be redeemed once', async () => {
    const h = harness();
    const invitation = await issued(h);
    await h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
      code: invitation.code,
      actorEmail: 'nueva@empresa.com',
    });

    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
    expect(
      h.memberships.memberships.filter((m) => m.userId === NEWCOMER),
    ).toHaveLength(1);
  });

  it('refuses an expired invitation without anything having swept it', async () => {
    const h = harness();
    const invitation = await issued(h);
    h.clock.advanceSeconds(INVITATION_TTL_HOURS * 3600 + 1);

    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
    // Still 'pending' in the row: expiry is derived, never written.
    expect(h.invitations.invitations[0].status).toBe('pending');
  });

  it('refuses once the issuer has lost standing', async () => {
    const h = harness();
    const invitation = await issued(h);
    h.memberships.memberships[0] = membership(
      'm-a',
      ORG_A,
      ADMIN_A,
      'organization_admin',
      'deactivated',
    );

    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
  });

  it('refuses once the issuer has been demoted below the invited template', async () => {
    const h = harness();
    const invitation = await issued(h);
    h.memberships.memberships[0] = membership(
      'm-a',
      ORG_A,
      ADMIN_A,
      'requester',
    );

    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
  });

  it('refuses acceptance into a suspended organization', async () => {
    const h = harness();
    const invitation = await issued(h);
    h.organizations.add(organization(ORG_A, 'chain-a', 'suspended'));

    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
  });

  it('leaves an existing membership untouched and publishes no membership event', async () => {
    const h = harness();
    const invitation = await issued(h, 'admin.a@empresa.com');
    // ADMIN_A is already an organization_admin here; the invitation names
    // 'agent'. Redeeming must not silently demote them.
    const accepted = await h.accept.execute(
      actor(ADMIN_A, ORG_A, 'organization_admin'),
      {
        code: invitation.code,
        actorEmail: 'admin.a@empresa.com',
      },
    );

    expect(accepted.membershipCreated).toBe(false);
    expect(accepted.membership.roleTemplate).toBe('organization_admin');
    expect(h.events.created).toHaveLength(0);
    expect(h.events.invitationsAccepted[0].membershipId).toBeUndefined();
  });
});

describe('listing and revoking', () => {
  it('never exposes the hash, and derives expiry at read time', async () => {
    const h = harness();
    await h.issue.execute(actor(ADMIN_A, ORG_A, 'organization_admin'), {
      inviteeEmail: 'x@empresa.com',
      roleTemplate: 'agent',
    });

    const fresh = await h.list.execute(
      actor(ADMIN_A, ORG_A, 'organization_admin'),
      { limit: 50, offset: 0 },
    );
    expect(JSON.stringify(fresh)).not.toContain(
      h.invitations.invitations[0].codeHash,
    );
    expect(fresh[0].expired).toBe(false);

    h.clock.advanceSeconds(INVITATION_TTL_HOURS * 3600 + 1);
    const stale = await h.list.execute(
      actor(ADMIN_A, ORG_A, 'organization_admin'),
      { limit: 50, offset: 0 },
    );
    expect(stale[0].expired).toBe(true);
    expect(stale[0].status).toBe('pending');
  });

  it('scopes the listing to the caller organization', async () => {
    const h = harness();
    await h.issue.execute(actor(ADMIN_A, ORG_A, 'organization_admin'), {
      inviteeEmail: 'x@empresa.com',
      roleTemplate: 'agent',
    });

    const otherOrg = await h.list.execute(
      actor(ADMIN_B, ORG_B, 'organization_admin'),
      { limit: 50, offset: 0 },
    );
    expect(otherOrg).toHaveLength(0);
  });

  it("answers not-found when another organization's admin revokes", async () => {
    const h = harness();
    const invitation = await h.issue.execute(
      actor(ADMIN_A, ORG_A, 'organization_admin'),
      { inviteeEmail: 'x@empresa.com', roleTemplate: 'agent' },
    );

    await expect(
      h.revoke.execute(
        actor(ADMIN_B, ORG_B, 'organization_admin'),
        invitation.invitation.id,
      ),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    expect(h.invitations.invitations[0].status).toBe('pending');
  });

  it('refuses to revoke an invitation that was already redeemed', async () => {
    const h = harness();
    const issuer = actor(ADMIN_A, ORG_A, 'organization_admin');
    const invitation = await h.issue.execute(issuer, {
      inviteeEmail: 'x@empresa.com',
      roleTemplate: 'agent',
    });
    await h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
      code: invitation.code,
      actorEmail: 'x@empresa.com',
    });

    await expect(
      h.revoke.execute(issuer, invitation.invitation.id),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
  });

  it('makes a revoked invitation unredeemable', async () => {
    const h = harness();
    const issuer = actor(ADMIN_A, ORG_A, 'organization_admin');
    const invitation = await h.issue.execute(issuer, {
      inviteeEmail: 'x@empresa.com',
      roleTemplate: 'agent',
    });
    await h.revoke.execute(issuer, invitation.invitation.id);

    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'x@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
    expect(h.events.invitationsRevoked[0].revokedByUserId).toBe(ADMIN_A);
  });
});

describe('previewing an invitation', () => {
  function previewer(h: Harness) {
    return new PreviewInvitationUseCase(
      h.invitations,
      h.organizations,
      h.clock,
    );
  }

  async function issued(h: Harness, email = 'nueva@empresa.com') {
    return h.issue.execute(actor(ADMIN_A, ORG_A, 'organization_admin'), {
      inviteeEmail: email,
      roleTemplate: 'agent',
    });
  }

  it('names the organization and the role without spending the code', async () => {
    const h = harness();
    const invitation = await issued(h);

    const preview = await previewer(h).execute(
      actor(NEWCOMER, undefined, 'none'),
      { code: invitation.code, actorEmail: 'nueva@empresa.com' },
    );

    expect(preview.organizationName).toBe('chain-a');
    expect(preview.roleTemplate).toBe('agent');
    // Still redeemable afterwards — that is the whole point.
    expect(h.invitations.invitations[0].status).toBe('pending');
    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).resolves.toBeDefined();
  });

  it('is not an oracle: it refuses everything accept refuses, alike', async () => {
    const h = harness();
    const invitation = await issued(h);
    const [id, secret] = invitation.code.split('.');
    const preview = previewer(h);
    const redeemer = actor(NEWCOMER, undefined, 'none');

    await expect(
      preview.execute(redeemer, {
        code: `${id}.${'z'.repeat(secret.length)}`,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(
      preview.execute(redeemer, {
        code: `99999999-9999-4999-8999-999999999999.${secret}`,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotFoundError);
    await expect(
      preview.execute(redeemer, {
        code: invitation.code,
        actorEmail: 'alguien.otro@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationAddresseeMismatchError);
  });

  it('refuses a spent or expired invitation', async () => {
    const h = harness();
    const invitation = await issued(h);
    await h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
      code: invitation.code,
      actorEmail: 'nueva@empresa.com',
    });

    await expect(
      previewer(h).execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
  });

  it('does not promise that accept will succeed', async () => {
    const h = harness();
    const invitation = await issued(h);
    // The issuer loses standing between preview and accept. Preview
    // deliberately does not re-check it — duplicating a redemption-time rule
    // is how two copies of a security check drift apart.
    const preview = await previewer(h).execute(
      actor(NEWCOMER, undefined, 'none'),
      { code: invitation.code, actorEmail: 'nueva@empresa.com' },
    );
    expect(preview.organizationName).toBe('chain-a');

    h.memberships.memberships[0] = membership(
      'm-a',
      ORG_A,
      ADMIN_A,
      'organization_admin',
      'deactivated',
    );
    await expect(
      h.accept.execute(actor(NEWCOMER, undefined, 'none'), {
        code: invitation.code,
        actorEmail: 'nueva@empresa.com',
      }),
    ).rejects.toBeInstanceOf(InvitationNotRedeemableError);
  });
});
