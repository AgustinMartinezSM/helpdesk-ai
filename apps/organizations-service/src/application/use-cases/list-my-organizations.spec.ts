import type { Actor } from '@helpdesk-ai/security';
import type { Membership, MembershipStatus } from '../../domain/membership';
import {
  BOOTSTRAP_ORGANIZATION_SLUG,
  type Organization,
} from '../../domain/organization';
import {
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
} from '../testing/fakes';
import { ListMyOrganizationsUseCase } from './list-my-organizations';

const AT = new Date('2026-08-04T12:00:00.000Z');

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const ACME_ID = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ID = '00000000-0000-4000-8000-0000000000bb';
const THEIRS_ID = '00000000-0000-4000-8000-0000000000cc';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '22222222-2222-4222-8222-222222222222';

function organization(over: Partial<Organization> = {}): Organization {
  return {
    id: ACME_ID,
    slug: 'acme',
    name: 'Acme',
    status: 'active',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function membership(over: Partial<Membership> = {}): Membership {
  return {
    id: `m-${over.organizationId ?? ACME_ID}-${over.userId ?? USER_ID}`,
    organizationId: ACME_ID,
    userId: USER_ID,
    roleTemplate: 'organization_admin',
    status: 'active',
    version: 1,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

function build() {
  const memberships = new InMemoryMembershipRepository();
  const organizations = new InMemoryOrganizationRepository();
  organizations.memberships = memberships;
  organizations.add(
    organization({
      id: BOOTSTRAP_ID,
      slug: BOOTSTRAP_ORGANIZATION_SLUG,
      name: 'Bootstrap organization',
    }),
  );
  organizations.add(organization());
  organizations.add(
    organization({ id: OTHER_ID, slug: 'other', name: 'Other' }),
  );

  return {
    memberships,
    organizations,
    useCase: new ListMyOrganizationsUseCase(memberships, organizations),
  };
}

const actor: Actor = { id: USER_ID, permissions: new Set<string>() };

describe('listing the organizations you can act in', () => {
  it('answers the ones held, with the name and the role', async () => {
    const ctx = build();
    ctx.memberships.memberships.push(
      membership(),
      membership({ organizationId: OTHER_ID, roleTemplate: 'agent' }),
    );

    expect(await ctx.useCase.execute(actor)).toEqual([
      {
        organizationId: ACME_ID,
        slug: 'acme',
        name: 'Acme',
        roleTemplate: 'organization_admin',
      },
      {
        organizationId: OTHER_ID,
        slug: 'other',
        name: 'Other',
        roleTemplate: 'agent',
      },
    ]);
  });

  it('never answers an organization somebody else belongs to', async () => {
    // The scoping here is the caller's own membership set rather than one
    // tenant, which is what makes this the platform's first deliberately
    // cross-tenant read — so the property gets a test rather than a comment.
    const ctx = build();
    ctx.organizations.add(
      organization({ id: THEIRS_ID, slug: 'theirs', name: 'Theirs' }),
    );
    ctx.memberships.memberships.push(
      membership(),
      membership({ organizationId: THEIRS_ID, userId: STRANGER_ID }),
    );

    const mine = await ctx.useCase.execute(actor);

    expect(mine.map((entry) => entry.organizationId)).toEqual([ACME_ID]);
  });

  it('excludes the bootstrap organization even when it is held', async () => {
    // It is migration data and a recovery anchor, not a workspace anybody
    // chooses. Offering it in a picker would invite people into the holding
    // pen.
    const ctx = build();
    ctx.memberships.memberships.push(
      membership({ organizationId: BOOTSTRAP_ID, roleTemplate: 'requester' }),
      membership(),
    );

    const mine = await ctx.useCase.execute(actor);

    expect(mine.map((entry) => entry.organizationId)).toEqual([ACME_ID]);
  });

  it('answers an empty list — not the holding pen — for a bootstrap-only account', async () => {
    // The truth: they have nothing to choose between. Their session still
    // resolves to bootstrap through the default rule, which is why this is a
    // LISTING rule and must never be applied to the resolver.
    const ctx = build();
    ctx.memberships.memberships.push(
      membership({ organizationId: BOOTSTRAP_ID, roleTemplate: 'requester' }),
    );

    expect(await ctx.useCase.execute(actor)).toEqual([]);
  });

  it('answers an empty list for somebody who belongs nowhere', async () => {
    const ctx = build();

    expect(await ctx.useCase.execute(actor)).toEqual([]);
  });

  it.each(['suspended', 'deactivated', 'invited'] as const)(
    'omits a %s membership',
    async (status: MembershipStatus) => {
      // A list that offered what the mint would then refuse is the picker
      // problem Sprint 9.14 fixed for role templates, one level up.
      const ctx = build();
      ctx.memberships.memberships.push(
        membership({ status }),
        membership({ organizationId: OTHER_ID }),
      );

      const mine = await ctx.useCase.execute(actor);

      expect(mine.map((entry) => entry.organizationId)).toEqual([OTHER_ID]);
    },
  );

  it('omits a suspended organization', async () => {
    const ctx = build();
    ctx.organizations.add(
      organization({
        id: OTHER_ID,
        slug: 'other',
        name: 'Other',
        status: 'suspended',
      }),
    );
    ctx.memberships.memberships.push(
      membership(),
      membership({ organizationId: OTHER_ID }),
    );

    const mine = await ctx.useCase.execute(actor);

    expect(mine.map((entry) => entry.organizationId)).toEqual([ACME_ID]);
  });

  it('lists oldest first, so the first entry is where a fresh sign-in lands', async () => {
    const ctx = build();
    ctx.memberships.memberships.push(
      membership({
        organizationId: OTHER_ID,
        createdAt: new Date('2026-08-04T14:00:00.000Z'),
      }),
      membership({ createdAt: new Date('2026-08-04T10:00:00.000Z') }),
    );

    const mine = await ctx.useCase.execute(actor);

    expect(mine.map((entry) => entry.organizationId)).toEqual([
      ACME_ID,
      OTHER_ID,
    ]);
  });
});
