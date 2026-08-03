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

/** The gate is the permission, never the role name (ADR 0020). */
const ADMIN_SESSION = {
  ...BASE_SESSION,
  permissions: ['branches.read', 'branches.create', 'branches.update'],
};
const READER_SESSION = { ...BASE_SESSION, permissions: ['branches.read'] };
const OUTSIDER_SESSION = { ...BASE_SESSION, permissions: ['tickets.read_own'] };
const TENANTLESS_SESSION = {
  ...BASE_SESSION,
  organizationId: null,
  permissions: ['branches.read'],
};

const STORE = {
  branchId: 'b1',
  code: 'store-12',
  name: 'Store 12',
  status: 'active' as const,
  timezone: 'UTC',
  address: null,
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

function renderPage() {
  return render(
    <AuthProvider>
      <OrganizationPage />
    </AuthProvider>,
  );
}

const EMPTY_STRUCTURE = { departments: [], stations: [] };

describe('OrganizationPage', () => {
  it('lists the branches an administrator registered', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/organization\/branches$/, { status: 200, body: [STORE] }, 'GET'],
    ]);
    renderPage();

    expect(await screen.findByText('Store 12')).toBeTruthy();
    expect(screen.getByText(/store-12/)).toBeTruthy();
    expect(screen.getByText('1 branch')).toBeTruthy();
  });

  it('registers a branch and says the code cannot change later', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
      [/\/organization\/branches$/, { status: 201, body: STORE }, 'POST'],
    ]);
    renderPage();

    await screen.findByLabelText('branch form');
    // Said before it is chosen, not after it cannot be changed.
    expect(screen.getByText(/cannot be changed later/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Code'), {
      target: { value: 'store-12' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Store 12' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Register branch' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'POST' &&
            call.url.endsWith('/organization/branches'),
        ),
      ).toBe(true),
    );
    // Scoped to the branch route: the session refresh is a POST too.
    const posted = calls.find(
      (call) =>
        call.init?.method === 'POST' &&
        call.url.endsWith('/organization/branches'),
    );
    expect(JSON.parse(String(posted?.init?.body))).toEqual({
      code: 'store-12',
      name: 'Store 12',
    });
  });

  it('archives a branch and keeps it in the list', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/organization\/branches$/, { status: 200, body: [STORE] }, 'GET'],
      [
        /\/organization\/branches\/b1$/,
        { status: 200, body: { ...STORE, status: 'archived' } },
        'PATCH',
      ],
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'PATCH' &&
            call.url.endsWith('/organization/branches/b1'),
        ),
      ).toBe(true),
    );
    const patched = calls.find((call) => call.init?.method === 'PATCH');
    expect(JSON.parse(String(patched?.init?.body))).toEqual({
      status: 'archived',
    });
  });

  it('opens a branch and adds a department and a service point', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/organization\/branches$/, { status: 200, body: [STORE] }, 'GET'],
      [
        /\/organization\/branches\/b1\/structure$/,
        { status: 200, body: EMPTY_STRUCTURE },
        'GET',
      ],
      [
        /\/organization\/branches\/b1\/departments$/,
        { status: 201, body: { departmentId: 'd1' } },
        'POST',
      ],
      [
        /\/organization\/branches\/b1\/stations$/,
        { status: 201, body: { stationId: 's1' } },
        'POST',
      ],
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    const departments = await screen.findByLabelText('Departments');
    fireEvent.change(within(departments).getByLabelText('New department'), {
      target: { value: 'Electronics' },
    });
    fireEvent.click(within(departments).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/b1/departments'))).toBe(
        true,
      ),
    );

    const stations = screen.getByLabelText('Service points');
    fireEvent.change(within(stations).getByLabelText('Code'), {
      target: { value: 'cashier-2' },
    });
    fireEvent.change(within(stations).getByLabelText('Name'), {
      target: { value: 'Cashier station 2' },
    });
    fireEvent.click(within(stations).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/b1/stations'))).toBe(
        true,
      ),
    );
  });

  it('says a service point is a place, not a login', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/organization\/branches$/, { status: 200, body: [STORE] }, 'GET'],
      [
        /\/organization\/branches\/b1\/structure$/,
        { status: 200, body: EMPTY_STRUCTURE },
        'GET',
      ],
    ]);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));

    // ADR 0016/0017: a station authenticates nothing. The interface has to
    // say so, or somebody will expect a shared login.
    expect(
      await screen.findByText(/It has no\s+login of its own/),
    ).toBeTruthy();
  });

  it('explains that archiving a branch keeps what is inside it', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [
        /\/organization\/branches$/,
        { status: 200, body: [{ ...STORE, status: 'archived' }] },
        'GET',
      ],
      [
        /\/organization\/branches\/b1\/structure$/,
        {
          status: 200,
          body: {
            departments: [
              {
                departmentId: 'd1',
                branchId: 'b1',
                name: 'Electronics',
                status: 'active',
              },
            ],
            stations: [],
          },
        },
        'GET',
      ],
    ]);
    renderPage();

    expect(await screen.findByText('Archived')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByText(/kept as they were/)).toBeTruthy();
    // No cascade (D4): the department is still active underneath. Awaited,
    // because the structure arrives after the panel has already rendered.
    expect(await screen.findByText('Electronics')).toBeTruthy();
  });

  it('lets a reader look without offering a single control', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: READER_SESSION }],
      [/\/organization\/branches$/, { status: 200, body: [STORE] }, 'GET'],
      [
        /\/organization\/branches\/b1\/structure$/,
        { status: 200, body: EMPTY_STRUCTURE },
        'GET',
      ],
    ]);
    renderPage();

    await screen.findByText('Store 12');
    expect(screen.queryByLabelText('branch form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await screen.findByLabelText('Departments');
    expect(screen.queryByLabelText(/add department/)).toBeNull();
  });

  it('turns somebody away who does not manage the organization', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: OUTSIDER_SESSION }],
    ]);
    renderPage();

    expect(
      await screen.findByText('You do not manage this organization'),
    ).toBeTruthy();
  });

  it('handles the belongs-nowhere session every account starts in', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TENANTLESS_SESSION }],
    ]);
    renderPage();

    expect(
      await screen.findByText('You are not part of an organization yet'),
    ).toBeTruthy();
  });

  it('renders a stale-permission refusal as a real message', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [
        /\/organization\/branches$/,
        {
          status: 403,
          body: {
            message:
              'you are not allowed to manage this organization structure',
          },
        },
        'GET',
      ],
    ]);
    renderPage();

    expect(
      await screen.findByText(
        'you are not allowed to manage this organization structure',
      ),
    ).toBeTruthy();
  });
});

describe('the authenticated navigation', () => {
  it('shows Organization only to somebody who may read branches', async () => {
    mockFetch([[/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }]]);
    render(
      <AuthProvider>
        <AppShell>content</AppShell>
      </AuthProvider>,
    );

    expect(
      await screen.findByRole('link', { name: 'Organization' }),
    ).toBeTruthy();
  });

  it('hides it from everybody else', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: OUTSIDER_SESSION }],
    ]);
    render(
      <AuthProvider>
        <AppShell>content</AppShell>
      </AuthProvider>,
    );

    await screen.findByRole('link', { name: 'Tickets' });
    expect(screen.queryByRole('link', { name: 'Organization' })).toBeNull();
  });
});
