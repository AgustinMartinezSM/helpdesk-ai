import type { Actor } from '@helpdesk-ai/security';
import { CreateOrganizationUseCase } from './create-organization';
import { AlreadyBelongsToOrganizationError } from '../../domain/errors';
import {
  BOOTSTRAP_ORGANIZATION_SLUG,
  isReservedSlug,
  slugFromName,
  type Organization,
} from '../../domain/organization';
import {
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
} from '../testing/fakes';
import type { MembershipEventPublisher } from '../ports/event-publisher';
import type { Membership } from '../../domain/membership';

const NOW = new Date('2026-08-03T12:00:00.000Z');

const BOOTSTRAP: Organization = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: BOOTSTRAP_ORGANIZATION_SLUG,
  name: 'Bootstrap organization',
  status: 'active',
  createdAt: NOW,
  updatedAt: NOW,
};

function actor(id = 'user-1'): Actor {
  return { id, permissions: new Set<string>() };
}

function membership(over: Partial<Membership> = {}): Membership {
  return {
    id: 'm-existing',
    organizationId: BOOTSTRAP.id,
    userId: 'user-1',
    roleTemplate: 'requester',
    status: 'active',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function build() {
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  organizations.memberships = memberships;
  organizations.add(BOOTSTRAP);

  const published: Membership[] = [];
  const events: MembershipEventPublisher = {
    membershipCreated: async (created) => {
      published.push(created);
    },
    membershipStatusChanged: async () => undefined,
    membershipRoleChanged: async () => undefined,
  } as unknown as MembershipEventPublisher;

  let n = 0;
  const useCase = new CreateOrganizationUseCase(
    organizations,
    memberships,
    { now: () => NOW },
    { next: () => `id-${(n += 1)}` },
    events,
  );

  return { useCase, organizations, memberships, published };
}

describe('creating an organization', () => {
  it('makes the creator its owner, in one write', async () => {
    const { useCase, organizations, memberships } = build();
    memberships.memberships.push(membership());

    const created = await useCase.execute(actor(), { name: 'Ferretería Sur' });

    expect(created.organization.name).toBe('Ferretería Sur');
    expect(created.organization.status).toBe('active');
    // The one place this template is written by application code, and the
    // reason it does not go through canGrantRoleTemplate: that derivation
    // excludes `owner` by constant so no GRANT path can produce one, and
    // this is not a grant path.
    expect(created.membership.roleTemplate).toBe('owner');
    expect(created.membership.userId).toBe('user-1');
    expect(created.membership.organizationId).toBe(created.organization.id);
    expect(
      await organizations.findById(created.organization.id),
    ).not.toBeNull();
  });

  it('publishes membership.created so the new owner reaches the directory', async () => {
    // users-service projects directory_memberships from this event. Without
    // it the owner is absent from the People screen of the organization they
    // were just given authority over.
    const { useCase, published } = build();

    const created = await useCase.execute(actor(), { name: 'Ferretería Sur' });

    expect(published).toHaveLength(1);
    expect(published[0].id).toBe(created.membership.id);
    expect(published[0].roleTemplate).toBe('owner');
  });

  it('is allowed for somebody who only holds the bootstrap membership', async () => {
    // Registration puts EVERYBODY in the holding pen unconditionally, so
    // "holds no membership" would refuse every caller that has ever
    // registered — which is all of them.
    const { useCase, memberships } = build();
    memberships.memberships.push(membership());

    await expect(
      useCase.execute(actor(), { name: 'Ferretería Sur' }),
    ).resolves.toBeDefined();
  });

  it('refuses somebody who already belongs to a real organization', async () => {
    /**
     * Not a policy — a platform limit. Resolution picks the OLDEST
     * non-bootstrap membership at every mint and there is no selector, so a
     * second organization would be one its own creator could never reach.
     */
    const { useCase, organizations, memberships } = build();
    const real: Organization = { ...BOOTSTRAP, id: 'org-real', slug: 'acme' };
    organizations.add(real);
    memberships.memberships.push(membership());
    memberships.memberships.push(
      membership({ id: 'm-real', organizationId: real.id }),
    );

    await expect(
      useCase.execute(actor(), { name: 'Second' }),
    ).rejects.toBeInstanceOf(AlreadyBelongsToOrganizationError);
  });

  it('ignores a membership that grants no access when deciding', async () => {
    // A deactivated membership in a real organization is not a place the
    // person can act, so it must not block them from creating one.
    const { useCase, organizations, memberships } = build();
    const real: Organization = { ...BOOTSTRAP, id: 'org-real', slug: 'acme' };
    organizations.add(real);
    memberships.memberships.push(
      membership({
        id: 'm-real',
        organizationId: real.id,
        status: 'deactivated',
      }),
    );

    await expect(
      useCase.execute(actor(), { name: 'Fresh start' }),
    ).resolves.toBeDefined();
  });
});

describe('the slug is derived, never chosen, never reported', () => {
  it('comes from the name', async () => {
    const { useCase } = build();
    const created = await useCase.execute(actor(), { name: 'Ferretería Sur' });
    expect(created.organization.slug).toBe('ferreteria-sur');
  });

  it('disambiguates a collision silently rather than refusing', async () => {
    /**
     * Refusing with "that name is taken" would answer "does an organization
     * by this name exist?" to anybody with an account, across tenants — and
     * the invitation preview is meant to be the only public place an
     * organization's name is exposed (Sprint 9.9).
     */
    const { useCase, organizations } = build();
    organizations.add({
      ...BOOTSTRAP,
      id: 'org-taken',
      slug: 'ferreteria-sur',
    });

    const created = await useCase.execute(actor(), { name: 'Ferretería Sur' });

    expect(created.organization.slug).not.toBe('ferreteria-sur');
    expect(created.organization.slug.startsWith('ferreteria-sur-')).toBe(true);
  });

  it('never mints the bootstrap slug', async () => {
    /**
     * This is provisioning-critical, not cosmetic. The bootstrap migration
     * inserts with ON CONFLICT ("id") DO NOTHING — the conflict target is the
     * id, not the slug — so a row already holding slug `bootstrap` under a
     * different id makes `prisma migrate deploy` fail on the unique index,
     * on every future environment.
     */
    const { useCase, organizations } = build();

    const created = await useCase.execute(actor(), { name: 'Bootstrap' });

    expect(created.organization.slug).not.toBe(BOOTSTRAP_ORGANIZATION_SLUG);
    expect(await organizations.findBySlug(BOOTSTRAP_ORGANIZATION_SLUG)).toBe(
      BOOTSTRAP,
    );
  });
});

describe('slug derivation', () => {
  it.each([
    ['Ferretería Sur', 'ferreteria-sur'],
    ['  Acme   Ltd.  ', 'acme-ltd'],
    ['Ñandú', 'nandu'],
    ['A&B', 'a-b'],
    ['---', 'org'],
    ['文文文', 'org'],
  ])('normalises %p to %p', (name, expected) => {
    expect(slugFromName(name)).toBe(expected);
  });

  it('folds accents so two names cannot produce look-alike slugs', () => {
    // A slug is a URL-shaped identifier; "nandu" and "ñandu" resolving to
    // two different organizations is a phishing surface, not a nicety.
    expect(slugFromName('Ñandú')).toBe(slugFromName('Nandu'));
  });

  it('stays within a length a URL and an index can carry', () => {
    expect(slugFromName('x'.repeat(200)).length).toBeLessThanOrEqual(48);
  });

  it('never ends in a hyphen, whatever the truncation did', () => {
    // Truncating mid-separator would otherwise leave "acme-" and make the
    // disambiguation suffix read as a double hyphen.
    expect(slugFromName(`${'a'.repeat(47)} b`).endsWith('-')).toBe(false);
  });

  it('recognises the reserved slug on the normalised form', () => {
    // The unique index is case-sensitive with no CHECK, so "Bootstrap" and
    // "bootstrap " both reach it. The reservation has to be applied after
    // normalisation or it guards nothing.
    expect(isReservedSlug(slugFromName('Bootstrap'))).toBe(true);
    expect(isReservedSlug(slugFromName('  BOOTSTRAP  '))).toBe(true);
    expect(isReservedSlug(slugFromName('Bootstrapping'))).toBe(false);
  });
});
