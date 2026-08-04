import type { Actor } from '@helpdesk-ai/security';
import { CreateOrganizationUseCase } from './create-organization';
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
  // Typed rather than cast: a cast through `unknown` would have made the
  // callback parameter implicitly `any`, and this file's whole job is to
  // assert what lands in that argument.
  const events: MembershipEventPublisher = {
    membershipCreated: async (created: Membership) => {
      published.push(created);
    },
    membershipStatusChanged: async () => undefined,
    membershipRoleChanged: async () => undefined,
  };

  let n = 0;
  const useCase = new CreateOrganizationUseCase(
    organizations,
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
    // Registration puts EVERYBODY in the holding pen unconditionally, so this
    // is the ordinary case rather than an edge one.
    const { useCase, memberships } = build();
    memberships.memberships.push(membership());

    await expect(
      useCase.execute(actor(), { name: 'Ferretería Sur' }),
    ).resolves.toBeDefined();
  });

  it('is allowed for somebody who ALREADY belongs to a real organization', async () => {
    /**
     * This was refused from Sprint 10.4 until 10.6, and the refusal was
     * conditional by construction: resolution picked the oldest non-bootstrap
     * membership at every mint and there was no selector, so a second
     * organization would have been unreachable by its own creator. ADR 0023
     * said to revisit it in the change that added token exchange, and ADR 0025
     * is that change.
     *
     * What makes this safe is NOT here: the caller has to switch into what it
     * just created, or the organization is stranded exactly as the refusal
     * warned. `organization/new/page.tsx` exchanges on the created id and a web
     * spec pins it.
     */
    const { useCase, organizations, memberships } = build();
    const real: Organization = { ...BOOTSTRAP, id: 'org-real', slug: 'acme' };
    organizations.add(real);
    memberships.memberships.push(membership());
    memberships.memberships.push(
      membership({ id: 'm-real', organizationId: real.id }),
    );

    const created = await useCase.execute(actor(), { name: 'Second' });

    expect(created.organization.name).toBe('Second');
    // And they own it, exactly as the first one's creator does.
    expect(created.membership.roleTemplate).toBe('owner');
    expect(created.membership.userId).toBe('user-1');
  });

  it('does not read the caller memberships at all any more', async () => {
    // The use case stopped taking a membership repository when the refusal was
    // lifted. Pinned because an unused dependency creeping back would be the
    // first sign somebody reintroduced a placement check here rather than in
    // the resolution that actually decides where a person lands.
    expect(CreateOrganizationUseCase.length).toBe(4);
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
