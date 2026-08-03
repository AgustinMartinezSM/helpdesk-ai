import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import PeoplePage from '../src/app/(app)/people/page';

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
  permissions: ['people.read', 'people.invite'],
};
const READER_SESSION = { ...BASE_SESSION, permissions: ['people.read'] };
const TENANTLESS_SESSION = {
  ...BASE_SESSION,
  organizationId: null,
  permissions: [] as string[],
};

const ADA = {
  userId: 'u9',
  email: 'ada@empresa.com',
  displayName: 'Ada Lovelace',
  preferredName: null,
  phone: null,
  registeredAt: '2026-01-01T00:00:00.000Z',
  roleTemplate: 'organization_admin',
};

const PENDING = {
  id: 'inv-1',
  inviteeEmail: 'nueva@empresa.com',
  roleTemplate: 'agent',
  status: 'pending' as const,
  expired: false,
  invitedByUserId: 'u1',
  expiresAt: '2026-08-09T12:00:00.000Z',
  acceptedByUserId: null,
  acceptedAt: null,
  createdAt: '2026-08-02T12:00:00.000Z',
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
      <PeoplePage />
    </AuthProvider>,
  );
}

describe('PeoplePage', () => {
  it('lists members with the role their membership carries', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/people$/, { status: 200, body: [ADA] }],
      [/\/people\/invitations$/, { status: 200, body: [] }],
    ]);
    renderPage();

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('ada@empresa.com')).toBeTruthy();
    // The product's word, not the model's key. Scoped to the members list,
    // because the invite form's role picker offers the same label.
    const members = screen.getByLabelText('Members');
    expect(
      Array.from(members.querySelectorAll('span')).some(
        (node) => node.textContent === 'Administrator',
      ),
    ).toBe(true);
  });

  it('renders a one-member organization without looking broken', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/people$/, { status: 200, body: [ADA] }],
      [/\/people\/invitations$/, { status: 200, body: [] }],
    ]);
    renderPage();

    expect(await screen.findByText('1 member')).toBeTruthy();
    expect(screen.getByText('No invitations yet.')).toBeTruthy();
  });

  it('hides the invite form from someone who may only read', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: READER_SESSION }],
      [/\/people$/, { status: 200, body: [ADA] }],
    ]);
    renderPage();

    await screen.findByText('Ada Lovelace');
    expect(screen.queryByLabelText('invite form')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Create invitation' }),
    ).toBeNull();
  });

  it('sends the invited person somewhere useful when they belong nowhere', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TENANTLESS_SESSION }],
    ]);
    renderPage();

    // The belongs-nowhere state is ordinary, not an error (ADR 0014).
    expect(
      await screen.findByText('You are not part of an organization yet'),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Use an invitation code' }),
    ).toBeTruthy();
  });

  it('shows the code once, says nothing was sent, and loses it on dismiss', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/people$/, { status: 200, body: [] }],
      [/\/people\/invitations$/, { status: 200, body: [] }, 'GET'],
      [
        /\/people\/invitations$/,
        { status: 201, body: { ...PENDING, code: 'inv-1.the-secret' } },
        'POST',
      ],
    ]);
    renderPage();

    await screen.findByLabelText('invite form');
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'nueva@empresa.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(await screen.findByText('inv-1.the-secret')).toBeTruthy();
    // The interface must not imply delivery happened.
    expect(screen.getByText(/We did not send this anywhere/)).toBeTruthy();

    const posted = calls.find(
      (call) =>
        call.init?.method === 'POST' &&
        call.url.endsWith('/people/invitations'),
    );
    expect(JSON.parse(String(posted?.init?.body))).toEqual({
      inviteeEmail: 'nueva@empresa.com',
      roleTemplate: 'requester',
    });

    // Dismissed means gone: nothing can fetch it again.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByText('inv-1.the-secret')).toBeNull(),
    );
  });

  it('never revokes on the first click', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/people$/, { status: 200, body: [] }],
      [/\/people\/invitations$/, { status: 200, body: [PENDING] }, 'GET'],
      [/\/revoke$/, { status: 200, body: { ...PENDING, status: 'revoked' } }],
    ]);
    renderPage();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Revoke — the invitation for nueva@empresa.com',
      }),
    );
    // Armed, not fired.
    expect(calls.some((call) => call.url.includes('/revoke'))).toBe(false);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Revoke — the invitation for nueva@empresa.com',
      }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/revoke'))).toBe(true),
    );
  });

  it('reads an expired invitation as expired, not as pending', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/people$/, { status: 200, body: [] }],
      [
        /\/people\/invitations$/,
        { status: 200, body: [{ ...PENDING, expired: true }] },
        'GET',
      ],
    ]);
    renderPage();

    expect(await screen.findByText(/Expired/)).toBeTruthy();
  });

  it('surfaces a stale-permission refusal instead of pretending it cannot happen', async () => {
    // The session says people.invite; the server disagrees because the
    // membership changed within the token's lifetime (ADR 0020).
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: ADMIN_SESSION }],
      [/\/people$/, { status: 200, body: [] }],
      [
        /\/people\/invitations$/,
        {
          status: 403,
          body: { message: 'you are not allowed to manage invitations here' },
        },
        'GET',
      ],
    ]);
    renderPage();

    expect(
      await screen.findByText('you are not allowed to manage invitations here'),
    ).toBeTruthy();
  });
});

describe('PeoplePage member administration', () => {
  const ADMIN = {
    ...BASE_SESSION,
    permissions: [
      'people.read',
      'people.invite',
      'people.assign_roles',
      'people.suspend',
      'branches.manage_members',
      'branches.read',
    ],
  };

  const SUSPENDED_BOB = {
    userId: 'u8',
    email: 'bob@empresa.com',
    displayName: 'Bob Requester',
    preferredName: null,
    phone: null,
    registeredAt: '2026-01-01T00:00:00.000Z',
    roleTemplate: 'requester',
    status: 'suspended',
  };

  function adminRoutes(
    people: unknown[],
    extra: Array<[RegExp, Scripted, string?]> = [],
  ): Array<[RegExp, Scripted, string?]> {
    return [
      [/\/session\/refresh$/, { status: 200, body: ADMIN }],
      ...extra,
      [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
      [/\/people\/invitations$/, { status: 200, body: [] }, 'GET'],
      [/\/people(\?|$)/, { status: 200, body: people }, 'GET'],
    ];
  }

  it('asks for every membership status, so a suspended colleague is visible', async () => {
    const calls = mockFetch(
      adminRoutes([{ ...ADA, status: 'active' }, SUSPENDED_BOB]),
    );
    renderPage();

    await screen.findByText('Bob Requester');
    expect(screen.getByText('Suspended')).toBeTruthy();
    // Without ?status=all the server answers active members only, and a
    // suspended person could never be reinstated from this screen.
    expect(calls.some((call) => call.url.includes('/people?status=all'))).toBe(
      true,
    );
  });

  it('offers no controls on your own membership', async () => {
    // Not politeness: the server refuses, and that refusal is what keeps an
    // organization from losing its last administrator (ADR 0021).
    mockFetch(
      adminRoutes([
        { ...ADA, userId: 'u1', displayName: 'Me Myself', status: 'active' },
      ]),
    );
    renderPage();

    await screen.findByText('Me Myself');
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
  });

  it('changes a role through the key the server checks', async () => {
    const calls = mockFetch(
      adminRoutes(
        [{ ...ADA, roleTemplate: 'requester', status: 'active' }],
        [
          [
            /\/people\/u9\/role$/,
            {
              status: 200,
              body: { userId: 'u9', roleTemplate: 'agent', version: 2 },
            },
            'PATCH',
          ],
          [
            /\/people\/u9\/branches$/,
            { status: 200, body: { userId: 'u9', branchIds: [] } },
            'GET',
          ],
        ],
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    // Scoped to the members list: the invite form has its own Role picker,
    // and the two must stay independent.
    const members = screen.getByLabelText('Members');
    fireEvent.change(within(members).getByLabelText('Role'), {
      target: { value: 'agent' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save role' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'PATCH' &&
            call.url.endsWith('/people/u9/role'),
        ),
      ).toBe(true),
    );
    const patched = calls.find((call) => call.url.endsWith('/people/u9/role'));
    expect(JSON.parse(String(patched?.init?.body))).toEqual({
      roleTemplate: 'agent',
    });
  });

  it('never suspends on the first click', async () => {
    const calls = mockFetch(
      adminRoutes(
        [{ ...ADA, roleTemplate: 'requester', status: 'active' }],
        [
          [
            /\/people\/u9\/status$/,
            {
              status: 200,
              body: { userId: 'u9', status: 'suspended', version: 2 },
            },
            'PATCH',
          ],
          [
            /\/people\/u9\/branches$/,
            { status: 200, body: { userId: 'u9', branchIds: [] } },
            'GET',
          ],
        ],
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Suspend — the membership of Ada Lovelace',
      }),
    );
    expect(calls.some((call) => call.url.endsWith('/people/u9/status'))).toBe(
      false,
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Suspend — the membership of Ada Lovelace',
      }),
    );
    await waitFor(() =>
      expect(calls.some((call) => call.url.endsWith('/people/u9/status'))).toBe(
        true,
      ),
    );
  });

  it('offers reinstatement to a removed member, because removal is reversible', async () => {
    mockFetch(
      adminRoutes(
        [{ ...SUSPENDED_BOB, status: 'deactivated' }],
        [
          [
            /\/people\/u8\/branches$/,
            { status: 200, body: { userId: 'u8', branchIds: [] } },
            'GET',
          ],
        ],
      ),
    );
    renderPage();

    await screen.findByText('Bob Requester');
    expect(screen.getByText('Removed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));

    expect(
      await screen.findByRole('button', { name: 'Reinstate' }),
    ).toBeTruthy();
    // Already removed: nothing left to remove.
    expect(
      screen.queryByRole('button', {
        name: 'Remove — Bob Requester from the organization',
      }),
    ).toBeNull();
  });

  it('says out loud that a suspension is not immediate', async () => {
    mockFetch(
      adminRoutes(
        [{ ...ADA, status: 'active' }],
        [
          [
            /\/people\/u9\/branches$/,
            { status: 200, body: { userId: 'u9', branchIds: [] } },
            'GET',
          ],
        ],
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    // The token outlives the change by up to fifteen minutes (ADR 0014), and
    // an admin who is not told that will think the product is broken.
    expect(await screen.findByText(/up to fifteen minutes/)).toBeTruthy();
  });

  it('sends the whole desired branch set, archived ones included', async () => {
    const calls = mockFetch(
      adminRoutes(
        [{ ...ADA, roleTemplate: 'branch_manager', status: 'active' }],
        [
          [
            /\/organization\/branches$/,
            {
              status: 200,
              body: [
                {
                  id: 'b1',
                  code: 'store-1',
                  name: 'Store 1',
                  status: 'active',
                },
                {
                  id: 'b2',
                  code: 'store-2',
                  name: 'Store 2',
                  status: 'active',
                },
                {
                  id: 'b3',
                  code: 'old',
                  name: 'Closed store',
                  status: 'archived',
                },
              ],
            },
            'GET',
          ],
          [
            /\/people\/u9\/branches$/,
            { status: 200, body: { userId: 'u9', branchIds: ['b1', 'b3'] } },
            'GET',
          ],
          [
            /\/people\/u9\/branches$/,
            {
              status: 200,
              body: { userId: 'u9', branchIds: ['b1', 'b3', 'b2'] },
            },
            'PATCH',
          ],
        ],
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    // The archived branch is listed BECAUSE it is covered: a replace that
    // could not name it would silently drop it.
    expect(await screen.findByText('Closed store (archived)')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Store 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Save branches' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'PATCH' &&
            call.url.endsWith('/people/u9/branches'),
        ),
      ).toBe(true),
    );
    const saved = calls.find(
      (call) =>
        call.init?.method === 'PATCH' &&
        call.url.endsWith('/people/u9/branches'),
    );
    expect(JSON.parse(String(saved?.init?.body))).toEqual({
      branchIds: ['b1', 'b3', 'b2'],
    });
  });

  it('renders an administration refusal as a real message', async () => {
    // The permission snapshot said yes; the stored membership says no.
    mockFetch(
      adminRoutes(
        [{ ...ADA, roleTemplate: 'requester', status: 'active' }],
        [
          [
            /\/people\/u9\/status$/,
            {
              status: 403,
              body: {
                message:
                  'you cannot manage a member whose role template is "owner"',
              },
            },
            'PATCH',
          ],
          [
            /\/people\/u9\/branches$/,
            { status: 200, body: { userId: 'u9', branchIds: [] } },
            'GET',
          ],
        ],
      ),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    const suspend = await screen.findByRole('button', {
      name: 'Suspend — the membership of Ada Lovelace',
    });
    fireEvent.click(suspend);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Suspend — the membership of Ada Lovelace',
      }),
    );

    expect(
      await screen.findByText(
        'you cannot manage a member whose role template is "owner"',
      ),
    ).toBeTruthy();
  });

  it('hides every administration control from a reader', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: READER_SESSION }],
      [/\/people$/, { status: 200, body: [ADA] }],
    ]);
    renderPage();

    await screen.findByText('Ada Lovelace');
    // Same page, same data, different permission list — the gate is the key
    // and never the role name.
    expect(screen.queryByRole('button', { name: 'Manage' })).toBeNull();
  });
});
