import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import TicketDetailPage from '../src/app/(app)/tickets/[id]/page';
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

/** owner / organization_admin / service_desk_manager: routes work. */
const ROUTER_SESSION = {
  ...BASE_SESSION,
  permissions: [
    'routing.manage',
    'teams.manage',
    'tickets.read_team',
    'tickets.change_status',
  ],
  user: { id: 'desk1', email: 'desk@b.com', roles: ['user'] },
};

/** team_manager / agent: sees the team's work, changes no routing. */
const TEAM_MEMBER_SESSION = {
  ...BASE_SESSION,
  permissions: ['tickets.read_team', 'tickets.read_own'],
  user: { id: 'tech1', email: 'tech@b.com', roles: ['user'] },
};

/** A requester: no team concept applies to them at all. */
const REQUESTER_SESSION = {
  ...BASE_SESSION,
  permissions: ['tickets.read_own', 'tickets.create'],
};

const IT_TEAM = {
  teamId: 't-it',
  code: 'it',
  name: 'IT support',
  status: 'active' as const,
};
const OLD_TEAM = {
  teamId: 't-old',
  code: 'old',
  name: 'Old desk',
  status: 'archived' as const,
};

function makeDetails(assignedTeamId: string | null = null) {
  return {
    ticket: {
      id: 't1',
      title: 'Broken printer',
      description: 'It shows a paper jam that is not there.',
      status: 'open',
      priority: 'high',
      category: null,
      requesterId: 'u1',
      assigneeId: null,
      branchId: null,
      assignedTeamId,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-01T10:00:00.000Z',
    },
    comments: [],
    history: [],
  };
}

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

function renderDetail() {
  return render(
    <AuthProvider>
      <TicketDetailPage />
    </AuthProvider>,
  );
}

describe('routing a ticket to a support team', () => {
  it('offers the organization’s active teams to a routing.manage holder', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ROUTER_SESSION }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails() }, 'GET'],
      [
        /\/organization\/teams$/,
        { status: 200, body: [IT_TEAM, OLD_TEAM] },
        'GET',
      ],
      [
        /\/tickets\/t1\/team$/,
        {
          status: 200,
          body: { ...makeDetails('t-it').ticket },
        },
        'PATCH',
      ],
    ]);
    renderDetail();

    expect(await screen.findByText('Not routed to a team yet.')).toBeTruthy();
    const picker = (await screen.findByLabelText(
      'Route to',
    )) as HTMLSelectElement;
    // Archived teams stay in the administration listing so they can be
    // reopened, and are not offered here: routing to one would earn a refusal
    // the picker could have prevented.
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'No team',
      'IT support',
    ]);

    fireEvent.change(picker, { target: { value: 't-it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/tickets/t1/team'))).toBe(
        true,
      ),
    );
    const patched = calls.find((call) => call.url.endsWith('/tickets/t1/team'));
    expect(JSON.parse(String(patched?.init?.body))).toEqual({ teamId: 't-it' });
  });

  it('clears the routing with an explicit null', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ROUTER_SESSION }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails('t-it') }, 'GET'],
      [/\/organization\/teams$/, { status: 200, body: [IT_TEAM] }, 'GET'],
      [
        /\/tickets\/t1\/team$/,
        { status: 200, body: makeDetails().ticket },
        'PATCH',
      ],
    ]);
    renderDetail();

    const picker = (await screen.findByLabelText(
      'Route to',
    )) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/tickets/t1/team'))).toBe(
        true,
      ),
    );
    const patched = calls.find((call) => call.url.endsWith('/tickets/t1/team'));
    expect(JSON.parse(String(patched?.init?.body))).toEqual({ teamId: null });
  });

  it('renders the one generic refusal instead of guessing its cause', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ROUTER_SESSION }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails() }, 'GET'],
      [/\/organization\/teams$/, { status: 200, body: [IT_TEAM] }, 'GET'],
      [
        /\/tickets\/t1\/team$/,
        {
          status: 422,
          body: {
            message:
              'The support team cannot take this ticket in this organization',
          },
        },
        'PATCH',
      ],
    ]);
    renderDetail();

    // Awaited on the option, not the picker: the panel renders before its
    // team listing arrives, and selecting a value that is not there yet
    // leaves the select on its placeholder.
    await screen.findByRole('option', { name: 'IT support' });
    fireEvent.change(screen.getByLabelText('Route to'), {
      target: { value: 't-it' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // Archived, foreign, out of scope and branchless all arrive as this one
    // message, and the screen repeats it rather than inventing a reason.
    expect(
      await screen.findByText(
        'The support team cannot take this ticket in this organization',
      ),
    ).toBeTruthy();
  });

  it('says branch coverage matters before somebody hits it', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ROUTER_SESSION }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails() }, 'GET'],
      [/\/organization\/teams$/, { status: 200, body: [IT_TEAM] }, 'GET'],
    ]);
    renderDetail();

    expect(
      await screen.findByText(/only covers certain branches/),
    ).toBeTruthy();
  });

  it('names the team for a read_team holder and offers them no control', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TEAM_MEMBER_SESSION }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails('t-it') }, 'GET'],
      [/\/organization\/teams\/mine$/, { status: 200, body: [IT_TEAM] }, 'GET'],
    ]);
    renderDetail();

    expect(await screen.findByText('IT support')).toBeTruthy();
    expect(screen.queryByLabelText('Route to')).toBeNull();
    // Their own teams, which is all their token entitles them to — never the
    // administration listing, which needs teams.manage.
    expect(calls.some((call) => call.url.endsWith('/organization/teams'))).toBe(
      false,
    );
    expect(
      calls.some((call) => call.url.endsWith('/organization/teams/mine')),
    ).toBe(true);
  });

  it('shows a requester nothing about internal teams', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: REQUESTER_SESSION }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails('t-it') }, 'GET'],
    ]);
    renderDetail();

    await screen.findByText('Broken printer');
    expect(screen.queryByText('Support team')).toBeNull();
    // And no team read is even attempted for them.
    expect(calls.some((call) => call.url.includes('/organization/teams'))).toBe(
      false,
    );
  });
});

describe('the ticket list team filter', () => {
  function renderList() {
    return render(
      <AuthProvider>
        <TicketsPage />
      </AuthProvider>,
    );
  }

  const EMPTY_PAGE = { items: [], total: 0 };

  it('offers the caller’s own teams and narrows the listing', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TEAM_MEMBER_SESSION }],
      [/\/organization\/teams\/mine$/, { status: 200, body: [IT_TEAM] }, 'GET'],
      [/\/tickets(\?|$)/, { status: 200, body: EMPTY_PAGE }, 'GET'],
    ]);
    renderList();

    fireEvent.click(await screen.findByRole('button', { name: 'IT support' }));

    await waitFor(() =>
      expect(
        calls.some((call) => call.url.includes('assignedTeamId=t-it')),
      ).toBe(true),
    );
  });

  it('does not ask about teams when the person is in none', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TEAM_MEMBER_SESSION }],
      [/\/organization\/teams\/mine$/, { status: 200, body: [] }, 'GET'],
      [/\/tickets(\?|$)/, { status: 200, body: EMPTY_PAGE }, 'GET'],
    ]);
    renderList();

    // An organization that configured no teams, or somebody who belongs to
    // none, is not asked about a concept that does not apply (ADR 0016).
    await screen.findByRole('button', { name: 'Open' });
    expect(screen.queryByLabelText('Filter by support team')).toBeNull();
  });

  it('never asks for teams on behalf of a requester', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: REQUESTER_SESSION }],
      [/\/tickets(\?|$)/, { status: 200, body: EMPTY_PAGE }, 'GET'],
    ]);
    renderList();

    await screen.findByRole('button', { name: 'Open' });
    expect(calls.some((call) => call.url.includes('/organization/teams'))).toBe(
      false,
    );
  });
});
