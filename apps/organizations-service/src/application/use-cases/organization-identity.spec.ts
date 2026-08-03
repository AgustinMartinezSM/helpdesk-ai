import {
  NoOrganizationContextError,
  PERMISSIONS,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenOrganizationActionError,
  MembershipNotFoundError,
  NotOrganizationOwnerError,
  OrganizationNotFoundError,
  OwnershipAlreadyHeldError,
  OwnershipTargetNotEligibleError,
  OwnershipTransferConflictError,
} from '../../domain/errors';
import {
  MEMBERSHIP_STATUSES,
  type Membership,
  type MembershipStatus,
} from '../../domain/membership';
import {
  BOOTSTRAP_ORGANIZATION_SLUG,
  normalizeOrganizationName,
  type Organization,
} from '../../domain/organization';
import { permissionsForTemplate } from '../../domain/permissions';
import {
  FakeOrganizationEventPublisher,
  FixedClock,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
} from '../testing/fakes';
import {
  GetOrganizationUseCase,
  RenameOrganizationUseCase,
} from './organization-identity';
import { TransferOrganizationOwnershipUseCase } from './transfer-organization-ownership';

const AT = new Date('2026-08-04T12:00:00.000Z');
const LATER = new Date('2026-08-04T13:00:00.000Z');

const ORG_ID = '00000000-0000-4000-8000-0000000000ff';
const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const OUTSIDER_ID = '44444444-4444-4444-8444-444444444444';

function organization(over: Partial<Organization> = {}): Organization {
  return {
    id: ORG_ID,
    slug: 'ferreteria-sur',
    name: 'Ferretería Sur',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function membership(over: Partial<Membership> = {}): Membership {
  return {
    id: `m-${over.userId ?? OWNER_ID}`,
    organizationId: ORG_ID,
    userId: OWNER_ID,
    roleTemplate: 'owner',
    status: 'active',
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

/**
 * A token matching the stored row each fixture creates.
 *
 * `null` for the organization, not `undefined`: a default parameter treats an
 * explicit `undefined` as "not supplied", so passing it would have silently
 * produced a tenanted actor and made every belongs-nowhere case assert nothing.
 */
function actorFor(
  userId: string,
  template: Parameters<typeof permissionsForTemplate>[0],
  organizationId: string | null = ORG_ID,
): Actor {
  return {
    id: userId,
    ...(organizationId === null ? {} : { organizationId }),
    permissions: new Set(permissionsForTemplate(template)),
  };
}

function build() {
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  organizations.memberships = memberships;
  organizations.add(organization());
  organizations.add(
    organization({
      id: BOOTSTRAP_ID,
      slug: BOOTSTRAP_ORGANIZATION_SLUG,
      name: 'Bootstrap organization',
    }),
  );

  const clock = new FixedClock(LATER);
  const events = new FakeOrganizationEventPublisher();

  return {
    organizations,
    memberships,
    clock,
    events,
    get: new GetOrganizationUseCase(organizations, memberships),
    rename: new RenameOrganizationUseCase(organizations, clock, events),
    transfer: new TransferOrganizationOwnershipUseCase(
      organizations,
      memberships,
      clock,
      events,
    ),
  };
}

/** The ordinary starting point: an owner and one active administrator. */
function seedOwnedOrganization(ctx: ReturnType<typeof build>) {
  ctx.memberships.memberships.push(
    membership(),
    membership({ userId: ADMIN_ID, roleTemplate: 'organization_admin' }),
  );
}

describe('normalizeOrganizationName', () => {
  it.each([
    ['  Ferretería Sur  ', 'Ferretería Sur'],
    ['Ferretería   Sur', 'Ferretería Sur'],
    ['Ferretería\tSur', 'Ferretería Sur'],
  ])('collapses %p to %p', (input, expected) => {
    expect(normalizeOrganizationName(input)).toBe(expected);
  });

  it('leaves case, accents and punctuation exactly as written', () => {
    // The slug folds those; a display name that could not say what its owner
    // wrote would be answering a URL's problem with the product's copy.
    expect(normalizeOrganizationName('Ferretería Ñandú S.R.L.')).toBe(
      'Ferretería Ñandú S.R.L.',
    );
  });
});

describe('reading the organization you are in', () => {
  it('answers the organization and that the owner owns it', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    const view = await ctx.get.execute(actorFor(OWNER_ID, 'owner'));

    expect(view.organization.name).toBe('Ferretería Sur');
    expect(view.organization.slug).toBe('ferreteria-sur');
    expect(view.viewerIsOwner).toBe(true);
  });

  it('tells an administrator they do not own it', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    const view = await ctx.get.execute(
      actorFor(ADMIN_ID, 'organization_admin'),
    );

    expect(view.viewerIsOwner).toBe(false);
  });

  it('answers a requester too: organization.read is in every template', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);
    ctx.memberships.memberships.push(
      membership({ userId: AGENT_ID, roleTemplate: 'requester' }),
    );

    const view = await ctx.get.execute(actorFor(AGENT_ID, 'requester'));

    expect(view.organization.name).toBe('Ferretería Sur');
    expect(view.viewerIsOwner).toBe(false);
  });

  it('survives an organization that has no owner at all', async () => {
    // The bootstrap organization is seeded by a migration with no owner, and
    // every read here has to survive that rather than treating it as a fault.
    const ctx = build();
    ctx.memberships.memberships.push(
      membership({ organizationId: BOOTSTRAP_ID, roleTemplate: 'requester' }),
    );

    const view = await ctx.get.execute(
      actorFor(OWNER_ID, 'requester', BOOTSTRAP_ID),
    );

    expect(view.viewerIsOwner).toBe(false);
  });

  it('refuses a token carrying no permissions at all', async () => {
    const ctx = build();

    await expect(
      ctx.get.execute({
        id: OWNER_ID,
        organizationId: ORG_ID,
        permissions: new Set(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenOrganizationActionError);
  });

  it('refuses a token carrying no organization', async () => {
    const ctx = build();

    await expect(
      ctx.get.execute(actorFor(OWNER_ID, 'owner', null)),
    ).rejects.toBeInstanceOf(NoOrganizationContextError);
  });
});

describe('renaming an organization', () => {
  it('changes the display name and leaves the slug alone', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    const renamed = await ctx.rename.execute(
      actorFor(ADMIN_ID, 'organization_admin'),
      { name: 'Ferretería Sur S.R.L.' },
    );

    expect(renamed.name).toBe('Ferretería Sur S.R.L.');
    // The decision this sprint is built around: display name and stable key
    // are different things (ADR 0024).
    expect(renamed.slug).toBe('ferreteria-sur');
    expect(renamed.id).toBe(ORG_ID);
    expect(renamed.updatedAt).toEqual(LATER);
  });

  it('normalises the name the same way creation does', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    const renamed = await ctx.rename.execute(actorFor(OWNER_ID, 'owner'), {
      name: '  Ferretería   Sur S.R.L. ',
    });

    expect(renamed.name).toBe('Ferretería Sur S.R.L.');
  });

  it('records who renamed it, and what it was called before', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    await ctx.rename.execute(actorFor(ADMIN_ID, 'organization_admin'), {
      name: 'Ferretería Norte',
    });

    expect(ctx.events.renamed).toHaveLength(1);
    expect(ctx.events.renamed[0].previousName).toBe('Ferretería Sur');
    expect(ctx.events.renamed[0].organization.name).toBe('Ferretería Norte');
    expect(ctx.events.renamed[0].renamedByUserId).toBe(ADMIN_ID);
  });

  it('treats the same name as a no-op, and publishes nothing', async () => {
    // Deliberately not SameRoleTemplateError's refusal: no version is bumped
    // and no token goes stale, so there is no stale picture to force a
    // re-read — and a rename that renamed nothing would sit in the audit
    // trail forever saying so.
    const ctx = build();
    seedOwnedOrganization(ctx);

    const unchanged = await ctx.rename.execute(actorFor(OWNER_ID, 'owner'), {
      name: '  Ferretería Sur ',
    });

    expect(unchanged.name).toBe('Ferretería Sur');
    expect(unchanged.updatedAt).toEqual(AT);
    expect(ctx.events.renamed).toHaveLength(0);
  });

  it.each([
    ['agent', AGENT_ID],
    ['requester', AGENT_ID],
    ['branch_manager', AGENT_ID],
    ['service_desk_manager', AGENT_ID],
    ['auditor', AGENT_ID],
  ] as const)(
    'refuses %s, who has no organization.update',
    async (template, id) => {
      const ctx = build();
      seedOwnedOrganization(ctx);
      ctx.memberships.memberships.push(
        membership({ userId: id, roleTemplate: template }),
      );

      await expect(
        ctx.rename.execute(actorFor(id, template), { name: 'Whatever' }),
      ).rejects.toBeInstanceOf(ForbiddenOrganizationActionError);
      expect(ctx.organizations.organizations.get(ORG_ID)?.name).toBe(
        'Ferretería Sur',
      );
    },
  );

  it('is granted to exactly owner and organization_admin', () => {
    // Pinned against the map rather than restated: the matrix gives
    // organization.update these two and nobody else, and a widening
    // elsewhere should fail here rather than quietly opening this surface.
    const holders = (
      [
        'owner',
        'organization_admin',
        'branch_manager',
        'service_desk_manager',
        'team_manager',
        'agent',
        'requester',
        'auditor',
      ] as const
    ).filter((template) =>
      permissionsForTemplate(template).has(PERMISSIONS.ORGANIZATION_UPDATE),
    );

    expect(holders).toEqual(['owner', 'organization_admin']);
  });

  it('refuses a token carrying no organization', async () => {
    const ctx = build();

    await expect(
      ctx.rename.execute(actorFor(OWNER_ID, 'owner', null), {
        name: 'Nowhere',
      }),
    ).rejects.toBeInstanceOf(NoOrganizationContextError);
  });

  it('reports an organization the token names but this database has never seen', async () => {
    const ctx = build();
    ctx.organizations.organizations.delete(ORG_ID);

    await expect(
      ctx.rename.execute(actorFor(OWNER_ID, 'owner'), { name: 'Ghost' }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
  });
});

describe('transferring ownership', () => {
  it('moves owner onto the target and leaves the previous owner an administrator', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    const transferred = await ctx.transfer.execute(
      actorFor(OWNER_ID, 'owner'),
      { userId: ADMIN_ID },
    );

    expect(transferred.newOwner.userId).toBe(ADMIN_ID);
    expect(transferred.newOwner.roleTemplate).toBe('owner');
    expect(transferred.previousOwner.userId).toBe(OWNER_ID);
    // Demoted, never removed: they keep every permission they were exercising
    // a moment earlier, and the organization does not lose an administrator
    // because somebody handed the top of it on.
    expect(transferred.previousOwner.roleTemplate).toBe('organization_admin');
  });

  it('leaves exactly one owner behind', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    await ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), {
      userId: ADMIN_ID,
    });

    const owners = ctx.memberships.memberships.filter(
      (row) => row.organizationId === ORG_ID && row.roleTemplate === 'owner',
    );
    expect(owners).toHaveLength(1);
    expect(owners[0].userId).toBe(ADMIN_ID);
    expect(await ctx.memberships.findOwner(ORG_ID)).toMatchObject({
      userId: ADMIN_ID,
    });
  });

  it('bumps both versions, so both outstanding tokens become detectably stale', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    const transferred = await ctx.transfer.execute(
      actorFor(OWNER_ID, 'owner'),
      { userId: ADMIN_ID },
    );

    expect(transferred.previousOwner.version).toBe(2);
    expect(transferred.newOwner.version).toBe(2);
  });

  it('publishes both role changes and one attributable transfer', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    await ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), {
      userId: ADMIN_ID,
    });

    // The role changes are what keep users-service's directory right; without
    // them the People screen would still show the previous owner as owner.
    expect(
      ctx.events.roleChanged.map((published) => [
        published.membership.userId,
        published.fromTemplate,
        published.membership.roleTemplate,
      ]),
    ).toEqual([
      [OWNER_ID, 'owner', 'organization_admin'],
      [ADMIN_ID, 'organization_admin', 'owner'],
    ]);

    // Neither of those says who decided it, which is what this one is for.
    expect(ctx.events.ownershipTransfers).toHaveLength(1);
    expect(ctx.events.ownershipTransfers[0].transfer).toMatchObject({
      organizationId: ORG_ID,
      transferredByUserId: OWNER_ID,
      previousOwnerUserId: OWNER_ID,
      newOwnerUserId: ADMIN_ID,
      newOwnerPreviousRoleTemplate: 'organization_admin',
    });
  });

  it('can hand the organization to somebody who is not an administrator', async () => {
    // Nothing requires the receiver to already be privileged: the owner
    // decides who runs their organization, and the receiver arrives holding
    // owner regardless of what they held a moment before.
    const ctx = build();
    seedOwnedOrganization(ctx);
    ctx.memberships.memberships.push(
      membership({ userId: AGENT_ID, roleTemplate: 'agent' }),
    );

    const transferred = await ctx.transfer.execute(
      actorFor(OWNER_ID, 'owner'),
      { userId: AGENT_ID },
    );

    expect(transferred.newOwner.roleTemplate).toBe('owner');
    expect(ctx.events.ownershipTransfers[0].transfer).toMatchObject({
      newOwnerPreviousRoleTemplate: 'agent',
    });
  });

  it('refuses an organization_admin: holding the same permissions is not owning it', async () => {
    // The sharpest invariant of the sprint. owner and organization_admin
    // resolve to the SAME permission set, so nothing in the token could tell
    // these two apart — only the stored row can, which is why it is read.
    const ctx = build();
    seedOwnedOrganization(ctx);
    ctx.memberships.memberships.push(
      membership({ userId: AGENT_ID, roleTemplate: 'agent' }),
    );

    await expect(
      ctx.transfer.execute(actorFor(ADMIN_ID, 'organization_admin'), {
        userId: AGENT_ID,
      }),
    ).rejects.toBeInstanceOf(NotOrganizationOwnerError);
    expect(await ctx.memberships.findOwner(ORG_ID)).toMatchObject({
      userId: OWNER_ID,
    });
  });

  it('refuses an administrator naming themselves', async () => {
    // Self-promotion, stated as its own case because it is the one somebody
    // would actually attempt.
    const ctx = build();
    seedOwnedOrganization(ctx);

    await expect(
      ctx.transfer.execute(actorFor(ADMIN_ID, 'organization_admin'), {
        userId: ADMIN_ID,
      }),
    ).rejects.toBeInstanceOf(NotOrganizationOwnerError);
  });

  it('refuses a token that still says owner when the row no longer does', async () => {
    // An access token lives 900 seconds. Somebody who handed the organization
    // over a minute ago carries claims that say owner, and this is the one
    // operation where spending them would take it back.
    const ctx = build();
    ctx.memberships.memberships.push(
      membership({ roleTemplate: 'organization_admin' }),
      membership({ userId: ADMIN_ID }),
      membership({ userId: AGENT_ID, roleTemplate: 'agent' }),
    );

    await expect(
      ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), { userId: AGENT_ID }),
    ).rejects.toBeInstanceOf(NotOrganizationOwnerError);
  });

  it('refuses an owner whose own membership is suspended', async () => {
    const ctx = build();
    ctx.memberships.memberships.push(
      membership({ status: 'suspended' }),
      membership({ userId: ADMIN_ID, roleTemplate: 'organization_admin' }),
    );

    await expect(
      ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), { userId: ADMIN_ID }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it('refuses the owner naming themselves', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    await expect(
      ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), { userId: OWNER_ID }),
    ).rejects.toBeInstanceOf(OwnershipAlreadyHeldError);
  });

  it('answers a member of ANOTHER organization exactly as it answers a stranger', async () => {
    // The tenant-isolation case, and the reason both are 404: telling the
    // caller apart would turn this endpoint into an oracle for which user ids
    // belong where.
    const ctx = build();
    seedOwnedOrganization(ctx);
    ctx.memberships.memberships.push(
      membership({
        organizationId: BOOTSTRAP_ID,
        userId: OUTSIDER_ID,
        roleTemplate: 'organization_admin',
      }),
    );

    const foreign = ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), {
      userId: OUTSIDER_ID,
    });
    const nobody = ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), {
      userId: '99999999-9999-4999-8999-999999999999',
    });

    await expect(foreign).rejects.toBeInstanceOf(MembershipNotFoundError);
    await expect(nobody).rejects.toBeInstanceOf(MembershipNotFoundError);
    expect(await ctx.memberships.findOwner(ORG_ID)).toMatchObject({
      userId: OWNER_ID,
    });
  });

  it.each(MEMBERSHIP_STATUSES.filter((status) => status !== 'active'))(
    'refuses a %s target',
    async (status: MembershipStatus) => {
      // invited (offered a place and not yet in it), suspended, deactivated.
      const ctx = build();
      ctx.memberships.memberships.push(
        membership(),
        membership({ userId: ADMIN_ID, roleTemplate: 'agent', status }),
      );

      await expect(
        ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), { userId: ADMIN_ID }),
      ).rejects.toBeInstanceOf(OwnershipTargetNotEligibleError);
      expect(await ctx.memberships.findOwner(ORG_ID)).toMatchObject({
        userId: OWNER_ID,
      });
    },
  );

  it('refuses to transfer the bootstrap organization, which nobody owns', async () => {
    const ctx = build();
    ctx.memberships.memberships.push(
      membership({ organizationId: BOOTSTRAP_ID }),
      membership({
        organizationId: BOOTSTRAP_ID,
        userId: ADMIN_ID,
        roleTemplate: 'organization_admin',
      }),
    );

    await expect(
      ctx.transfer.execute(actorFor(OWNER_ID, 'owner', BOOTSTRAP_ID), {
        userId: ADMIN_ID,
      }),
    ).rejects.toBeInstanceOf(NotOrganizationOwnerError);
  });

  it('refuses a token carrying no organization', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    await expect(
      ctx.transfer.execute(actorFor(OWNER_ID, 'owner', null), {
        userId: ADMIN_ID,
      }),
    ).rejects.toBeInstanceOf(NoOrganizationContextError);
  });

  it('reports a lost race rather than writing against a state that moved', async () => {
    // The repository's conditional update answers null when the ownership it
    // was decided against is gone. Simulated here because a fake cannot
    // interleave two transactions; the real interleaving is proved against
    // PostgreSQL in create-organization's neighbour suite.
    const ctx = build();
    seedOwnedOrganization(ctx);
    ctx.memberships.transferOwnership = async () => null;

    await expect(
      ctx.transfer.execute(actorFor(OWNER_ID, 'owner'), { userId: ADMIN_ID }),
    ).rejects.toBeInstanceOf(OwnershipTransferConflictError);
    expect(ctx.events.ownershipTransfers).toHaveLength(0);
    expect(ctx.events.roleChanged).toHaveLength(0);
  });

  it('publishes nothing when the write did not happen', async () => {
    const ctx = build();
    seedOwnedOrganization(ctx);

    await expect(
      ctx.transfer.execute(actorFor(ADMIN_ID, 'organization_admin'), {
        userId: OWNER_ID,
      }),
    ).rejects.toBeInstanceOf(NotOrganizationOwnerError);

    expect(ctx.events.roleChanged).toHaveLength(0);
    expect(ctx.events.ownershipTransfers).toHaveLength(0);
  });
});

describe('what a transfer must NOT change (ADR 0021)', () => {
  it('leaves the new owner unadministrable, exactly as the previous one was', async () => {
    // The rule that makes owner untouchable follows the row, not the person.
    // After a transfer the receiver is the one nobody can demote or suspend,
    // and the former owner becomes ordinarily administrable again.
    const { isGrantableRoleTemplate } =
      await import('../../domain/role-grants');
    const ctx = build();
    seedOwnedOrganization(ctx);

    const transferred = await ctx.transfer.execute(
      actorFor(OWNER_ID, 'owner'),
      { userId: ADMIN_ID },
    );

    expect(isGrantableRoleTemplate(transferred.newOwner.roleTemplate)).toBe(
      false,
    );
    expect(
      isGrantableRoleTemplate(transferred.previousOwner.roleTemplate),
    ).toBe(true);
  });

  it('keeps owner out of the grantable set', async () => {
    const { GRANTABLE_ROLE_TEMPLATES } =
      await import('../../domain/role-grants');
    // Nothing this sprint added may widen it: a transfer moves an existing
    // owner, it does not make one grantable.
    expect(GRANTABLE_ROLE_TEMPLATES).not.toContain('owner');
  });
});
