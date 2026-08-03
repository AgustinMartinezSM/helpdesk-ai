import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ROLE_TEMPLATES } from '@helpdesk-ai/security/role-templates';
import { AuthProvider } from '../src/components/auth-context';
import { roleLabel } from '../src/lib/people';
import PeoplePage from '../src/app/(app)/people/page';
import TicketsPage from '../src/app/(app)/tickets/page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: 't1' }),
}));

const BASE_SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: 'org-1',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

const ADMIN_SESSION = {
  ...BASE_SESSION,
  permissions: ['people.read', 'people.invite', 'people.assign_roles'],
};

const TEAM_MEMBER_SESSION = {
  ...BASE_SESSION,
  permissions: ['tickets.read_team', 'tickets.read_own'],
};

interface Scripted {
  status: number;
  body: unknown;
}

function mockFetch(
  routes: Array<[matcher: RegExp, response: Scripted, method?: string]>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const method = init?.method ?? 'GET';
      const match = routes.find(
        ([pattern, , forMethod]) =>
          pattern.test(url) && (!forMethod || forMethod === method),
      );
      const scripted = match?.[1] ?? { status: 404, body: {} };
      return {
        ok: scripted.status >= 200 && scripted.status < 300,
        status: scripted.status,
        json: async () => scripted.body,
      } as Response;
    },
  ) as unknown as typeof fetch;
  return calls;
}

/**
 * Required case 6: display names are separate from keys, so they can be
 * translated without touching anything stored.
 */
describe('role display names (required case 6)', () => {
  it('gives every template in the shared vocabulary a label', () => {
    // The vocabulary is imported, not restated. A template added server-side
    // fails here rather than leaking a raw key like `service_desk_manager`
    // into the interface.
    for (const template of ROLE_TEMPLATES) {
      expect(roleLabel(template)).not.toBe(template);
      expect(roleLabel(template).length).toBeGreaterThan(0);
    }
  });

  it('keeps the label free to differ from the key', () => {
    // The product says Technician and Employee; the database says agent and
    // requester. That divergence is the feature — it is what makes these
    // strings translatable while the keys stay stored.
    expect(roleLabel('agent')).toBe('Technician');
    expect(roleLabel('requester')).toBe('Employee');
  });

  it('falls back to the key rather than hiding an unknown template', () => {
    expect(roleLabel('something_new')).toBe('something_new');
    expect(roleLabel(undefined)).toBe('Member');
  });
});

/**
 * Required case 1, from the browser's side: the roles offered come from the
 * server, per actor, rather than from a list this app used to keep.
 */
describe('the invite form offers what the server would accept', () => {
  const PERSON = {
    userId: 'u9',
    email: 'ada@empresa.com',
    displayName: 'Ada Lovelace',
    preferredName: null,
    phone: null,
    registeredAt: '2026-01-01T00:00:00.000Z',
    roleTemplate: 'requester',
    status: 'active',
  };

  function peopleRoutes(roleTemplates: string[]) {
    return [
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
      [/\/people\/invitations$/, { status: 200, body: [] }, 'GET'],
      [
        /\/people\/role-templates$/,
        { status: 200, body: { roleTemplates } },
        'GET',
      ],
      [/\/people(\?|$)/, { status: 200, body: [PERSON] }, 'GET'],
    ] as Array<[RegExp, Scripted, string?]>;
  }

  function renderPeople() {
    return render(
      <AuthProvider>
        <PeoplePage />
      </AuthProvider>,
    );
  }

  it('renders exactly the templates the server named', async () => {
    mockFetch(peopleRoutes(['agent', 'requester']));
    renderPeople();

    const picker = (await screen.findByLabelText('Role')) as HTMLSelectElement;
    await waitFor(() => expect(picker.options).toHaveLength(2));

    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'Technician',
      'Employee',
    ]);
    // An admin's answer would include this; a narrower actor's does not, and
    // the form must not offer what would be refused on submit.
    expect([...picker.options].map((option) => option.value)).not.toContain(
      'organization_admin',
    );
  });

  it('offers no role at all when the server answers none', async () => {
    mockFetch(peopleRoutes([]));
    renderPeople();

    await screen.findByLabelText('Email address');
    const picker = screen.getByLabelText('Role') as HTMLSelectElement;
    // An empty answer is real, and an empty picker is the honest rendering of
    // it — better than a default the server would reject.
    expect(picker.options).toHaveLength(0);
  });

  it('never offers owner, whatever else it offers', async () => {
    mockFetch(
      peopleRoutes([
        'organization_admin',
        'branch_manager',
        'service_desk_manager',
        'team_manager',
        'agent',
        'requester',
        'auditor',
      ]),
    );
    renderPeople();

    const picker = (await screen.findByLabelText('Role')) as HTMLSelectElement;
    await waitFor(() => expect(picker.options).toHaveLength(7));
    expect([...picker.options].map((option) => option.value)).not.toContain(
      'owner',
    );
  });
});

/**
 * Sprint 9.14, D8: the ticket list's team control describes what it does.
 */
describe('the team scope control says what it does', () => {
  const IT_TEAM = {
    teamId: 't-it',
    code: 'it',
    name: 'IT support',
    status: 'active' as const,
  };
  const EMPTY_PAGE = { items: [], total: 0 };

  function renderTickets() {
    return render(
      <AuthProvider>
        <TicketsPage />
      </AuthProvider>,
    );
  }

  it('is a Show group rather than a Filter group', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TEAM_MEMBER_SESSION }],
      [/\/organization\/teams\/mine$/, { status: 200, body: [IT_TEAM] }, 'GET'],
      [/\/tickets(\?|$)/, { status: 200, body: EMPTY_PAGE }, 'GET'],
    ]);
    renderTickets();

    // The server's team scope is `assignedTeamId IN (…) OR requesterId = me`
    // — a visibility union, deliberate since 9.5. Sprint 9.13 labelled it a
    // filter, which promised a narrowing it does not perform.
    expect(await screen.findByLabelText('Show tickets')).toBeTruthy();
    expect(screen.queryByLabelText('Filter by support team')).toBeNull();
  });

  it('says own requests stay visible once a team is chosen', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TEAM_MEMBER_SESSION }],
      [/\/organization\/teams\/mine$/, { status: 200, body: [IT_TEAM] }, 'GET'],
      [/\/tickets(\?|$)/, { status: 200, body: EMPTY_PAGE }, 'GET'],
    ]);
    renderTickets();

    fireEvent.click(await screen.findByRole('button', { name: 'IT support' }));

    expect(
      await screen.findByText(/plus any request you opened yourself/),
    ).toBeTruthy();
  });

  it('says nothing extra while no team is chosen', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TEAM_MEMBER_SESSION }],
      [/\/organization\/teams\/mine$/, { status: 200, body: [IT_TEAM] }, 'GET'],
      [/\/tickets(\?|$)/, { status: 200, body: EMPTY_PAGE }, 'GET'],
    ]);
    renderTickets();

    await screen.findByRole('button', { name: 'IT support' });
    expect(
      screen.queryByText(/plus any request you opened yourself/),
    ).toBeNull();
  });
});
