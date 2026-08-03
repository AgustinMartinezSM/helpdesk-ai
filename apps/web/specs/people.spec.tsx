import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
