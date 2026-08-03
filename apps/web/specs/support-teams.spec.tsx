import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import OrganizationPage from '../src/app/(app)/organization/page';
import { AppShell } from '../src/components/app-shell';

const BASE_SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: 'org-1',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

/** Owner or organization_admin: runs branches and teams alike. */
const ADMIN_SESSION = {
  ...BASE_SESSION,
  permissions: [
    'branches.read',
    'branches.create',
    'branches.update',
    'teams.manage',
    'people.read',
  ],
};

/**
 * The service desk manager as the map now resolves them: they administer
 * support teams and read what the editors need, and they register no branch.
 */
const DESK_MANAGER_SESSION = {
  ...BASE_SESSION,
  // The narrow candidate key, not the directory: Sprint 9.14 traded 9.13's
  // interim `people.read` widening down to this.
  permissions: ['teams.manage', 'branches.read', 'people.read_assignable'],
};

/** Holds tickets.read_team and no team administration. */
const AGENT_SESSION = {
  ...BASE_SESSION,
  permissions: ['branches.read', 'tickets.read_team'],
};

const STORE = {
  branchId: 'b1',
  code: 'store-12',
  name: 'Store 12',
  status: 'active' as const,
  timezone: 'UTC',
  address: null,
};

const IT_TEAM = {
  teamId: 't1',
  code: 'it',
  name: 'IT support',
  status: 'active' as const,
};

/**
 * A candidate, not a directory row (Sprint 9.14): id, name and email, and
 * deliberately no role, status or phone — the desk manager who staffs a team
 * holds `people.read_assignable` and cannot read those.
 */
const PERSON = {
  userId: 'u9',
  name: 'Dana Tech',
  email: 'tech@company.com',
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

/** The four reads the Organization screen makes for a team administrator. */
function scriptOrganization(
  session: unknown,
  overrides: {
    teams?: Scripted;
    detail?: Scripted;
    people?: Scripted;
    branches?: Scripted;
  } = {},
): Array<[RegExp, Scripted, string?]> {
  return [
    [/\/session\/refresh$/, { status: 200, body: session }],
    [
      /\/organization\/branches$/,
      overrides.branches ?? { status: 200, body: [STORE] },
      'GET',
    ],
    [
      /\/organization\/teams$/,
      overrides.teams ?? { status: 200, body: [IT_TEAM] },
      'GET',
    ],
    [
      /\/organization\/teams\/t1$/,
      overrides.detail ?? {
        status: 200,
        body: { ...IT_TEAM, memberUserIds: [], branchIds: [] },
      },
      'GET',
    ],
    [
      /\/people\/assignable$/,
      overrides.people ?? { status: 200, body: [PERSON] },
    ],
  ];
}

function renderPage() {
  return render(
    <AuthProvider>
      <OrganizationPage />
    </AuthProvider>,
  );
}

/**
 * Waits for the team row and opens its panel.
 *
 * Scoped to the section rather than the page: a branch row carries an 'Open'
 * button of its own, and the two sections deliberately look alike.
 */
async function openTeamPanel() {
  await screen.findByText('IT support');
  const section = screen.getByLabelText('Support teams');
  fireEvent.click(within(section).getByRole('button', { name: 'Open' }));
  return section;
}

describe('the support teams section', () => {
  it('lists the teams and says a team is not a department', async () => {
    mockFetch(scriptOrganization(ADMIN_SESSION));
    renderPage();

    // Awaited on the row rather than on the section: the section renders with
    // its create form while the listing is still in flight.
    expect(await screen.findByText('IT support')).toBeTruthy();
    const section = screen.getByLabelText('Support teams');
    // ADR 0022's whole point, on the one screen that shows both words. A
    // reader has just seen departments inside a branch above.
    expect(within(section).getByText(/This is not a department/)).toBeTruthy();
    // And no department control lives anywhere inside it.
    expect(within(section).queryByLabelText(/department/i)).toBeNull();
  });

  it('creates a team, saying the code is fixed and the reach starts wide', async () => {
    const calls = mockFetch([
      ...scriptOrganization(ADMIN_SESSION, {
        teams: { status: 200, body: [] },
      }),
      [/\/organization\/teams$/, { status: 201, body: IT_TEAM }, 'POST'],
    ]);
    renderPage();

    const form = await screen.findByLabelText('support team form');
    // Both facts said BEFORE they are chosen, not after neither can be undone.
    expect(within(form).getByText(/cannot be changed\s+later/)).toBeTruthy();
    expect(
      within(form).getByText(/starts serving the whole organization/),
    ).toBeTruthy();

    fireEvent.change(within(form).getByLabelText('Code'), {
      target: { value: 'it' },
    });
    fireEvent.change(within(form).getByLabelText('Name'), {
      target: { value: 'IT support' },
    });
    fireEvent.click(
      within(form).getByRole('button', { name: 'Create support team' }),
    );

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'POST' &&
            call.url.endsWith('/organization/teams'),
        ),
      ).toBe(true),
    );
    const posted = calls.find(
      (call) =>
        call.init?.method === 'POST' &&
        call.url.endsWith('/organization/teams'),
    );
    expect(JSON.parse(String(posted?.init?.body))).toEqual({
      code: 'it',
      name: 'IT support',
    });
  });

  it('keeps an archived team on the screen so it can be reopened', async () => {
    const calls = mockFetch([
      ...scriptOrganization(ADMIN_SESSION, {
        teams: { status: 200, body: [{ ...IT_TEAM, status: 'archived' }] },
      }),
      [/\/organization\/teams\/t1$/, { status: 200, body: IT_TEAM }, 'PATCH'],
    ]);
    renderPage();

    const reopen = await screen.findByRole('button', { name: 'Reopen' });
    expect(screen.getByText('Archived')).toBeTruthy();
    fireEvent.click(reopen);

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'PATCH' &&
            call.url.endsWith('/organization/teams/t1'),
        ),
      ).toBe(true),
    );
    const patched = calls.find((call) => call.init?.method === 'PATCH');
    expect(JSON.parse(String(patched?.init?.body))).toEqual({
      status: 'active',
    });
  });

  it('reads no coverage rows as the whole organization, not as nothing', async () => {
    mockFetch(scriptOrganization(ADMIN_SESSION));
    renderPage();

    await openTeamPanel();

    const coverage = await screen.findByLabelText('Coverage of IT support');
    expect(
      within(coverage).getByText(/serves the whole organization/),
    ).toBeTruthy();
  });

  it('narrows coverage to a branch and puts it back with an empty set', async () => {
    const calls = mockFetch([
      ...scriptOrganization(ADMIN_SESSION, {
        detail: {
          status: 200,
          body: { ...IT_TEAM, memberUserIds: [], branchIds: ['b1'] },
        },
      }),
      [
        /\/organization\/teams\/t1\/branches$/,
        { status: 200, body: { teamId: 't1', branchIds: [] } },
        'PATCH',
      ],
    ]);
    renderPage();

    await openTeamPanel();

    const coverage = await screen.findByLabelText('Coverage of IT support');
    expect(within(coverage).getByText(/only the branch/)).toBeTruthy();

    fireEvent.click(
      within(coverage).getByRole('button', {
        name: 'Serve the whole organization',
      }),
    );
    fireEvent.click(
      within(coverage).getByRole('button', { name: 'Save coverage' }),
    );

    await waitFor(() =>
      expect(
        calls.some((call) =>
          call.url.endsWith('/organization/teams/t1/branches'),
        ),
      ).toBe(true),
    );
    const patched = calls.find((call) =>
      call.url.endsWith('/organization/teams/t1/branches'),
    );
    // The empty array is the instruction, not an omission: it is what makes
    // the team organization-wide again (ADR 0022).
    expect(JSON.parse(String(patched?.init?.body))).toEqual({ branchIds: [] });
  });

  it('picks members by name and says team membership is not department membership', async () => {
    const calls = mockFetch([
      ...scriptOrganization(ADMIN_SESSION),
      [
        /\/organization\/teams\/t1\/members$/,
        { status: 200, body: { teamId: 't1', memberUserIds: ['u9'] } },
        'PATCH',
      ],
    ]);
    renderPage();

    await openTeamPanel();

    const people = await screen.findByLabelText('People in IT support');
    expect(
      within(people).getByText(/separate from any department/),
    ).toBeTruthy();

    fireEvent.click(within(people).getByLabelText('Dana Tech'));
    fireEvent.click(
      within(people).getByRole('button', { name: 'Save people' }),
    );

    await waitFor(() =>
      expect(
        calls.some((call) =>
          call.url.endsWith('/organization/teams/t1/members'),
        ),
      ).toBe(true),
    );
    const patched = calls.find((call) =>
      call.url.endsWith('/organization/teams/t1/members'),
    );
    // The whole desired set, by userId — never a membership id.
    expect(JSON.parse(String(patched?.init?.body))).toEqual({
      userIds: ['u9'],
    });
  });

  it('does not pretend removal is instant', async () => {
    mockFetch(
      scriptOrganization(ADMIN_SESSION, {
        detail: {
          status: 200,
          body: { ...IT_TEAM, memberUserIds: ['u9'], branchIds: [] },
        },
      }),
    );
    renderPage();

    await openTeamPanel();

    // The `tm` claim is minted with the token (ADR 0014), so the effect lands
    // at the next session renewal and the screen says so.
    expect(await screen.findByText(/until their session renews/)).toBeTruthy();
  });

  it('explains itself when the directory cannot be read', async () => {
    mockFetch(
      scriptOrganization(ADMIN_SESSION, {
        people: { status: 403, body: { message: 'nope' } },
      }),
    );
    renderPage();

    await openTeamPanel();

    // Not an empty list, which would read as "nobody works here".
    expect(
      await screen.findByText(/list of people could not be loaded/),
    ).toBeTruthy();
  });

  it('shows a service desk manager the teams without the branch form', async () => {
    mockFetch(scriptOrganization(DESK_MANAGER_SESSION));
    renderPage();

    await screen.findByText('IT support');
    // They read branches — the coverage editor needs the names — and register
    // none: one key per section, never one "can set up the organization"
    // boolean.
    expect(screen.queryByLabelText('branch form')).toBeNull();
    expect(screen.getByLabelText('support team form')).toBeTruthy();
  });

  it('shows nothing about teams to somebody who only reads their own', async () => {
    mockFetch(scriptOrganization(AGENT_SESSION));
    renderPage();

    await screen.findByText('Store 12');
    // tickets.read_team is about seeing the team's WORK, not about running
    // the team. The section is not rendered and the listing is never asked
    // for.
    expect(screen.queryByLabelText('Support teams')).toBeNull();
  });

  it('renders a stale-permission refusal on the teams listing as a message', async () => {
    mockFetch(
      scriptOrganization(ADMIN_SESSION, {
        teams: {
          status: 403,
          body: { message: 'you are not allowed to manage support teams' },
        },
      }),
    );
    renderPage();

    expect(
      await screen.findByText('you are not allowed to manage support teams'),
    ).toBeTruthy();
  });
});

describe('the Organization navigation entry', () => {
  it('appears for a team administrator who reads no branches', async () => {
    mockFetch([
      [
        /\/session\/refresh$/,
        {
          status: 200,
          body: { ...BASE_SESSION, permissions: ['teams.manage'] },
        },
      ],
    ]);
    render(
      <AuthProvider>
        <AppShell>content</AppShell>
      </AuthProvider>,
    );

    expect(
      await screen.findByRole('link', { name: 'Organization' }),
    ).toBeTruthy();
  });
});
