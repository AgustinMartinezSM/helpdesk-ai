import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import JoinPage from '../src/app/(app)/join/page';

/** The redeemer's normal state: signed in, belonging nowhere yet. */
const TENANTLESS_SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: null,
  user: { id: 'u1', email: 'nueva@empresa.com', roles: ['user'] },
};

const JOINED_SESSION = {
  ...TENANTLESS_SESSION,
  organizationId: 'org-1',
  permissions: ['tickets.create', 'tickets.read_own'],
};

interface Scripted {
  status: number;
  body: unknown;
}

function mockFetch(routes: Array<[RegExp, Scripted | Scripted[]]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const cursors = new Map<RegExp, number>();
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const match = routes.find(([pattern]) => pattern.test(url));
      let scripted: Scripted = { status: 404, body: {} };
      if (match) {
        const [pattern, response] = match;
        if (Array.isArray(response)) {
          // Sequenced: the session refresh answers differently before and
          // after the membership exists.
          const index = cursors.get(pattern) ?? 0;
          scripted = response[Math.min(index, response.length - 1)];
          cursors.set(pattern, index + 1);
        } else {
          scripted = response;
        }
      }
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
      <JoinPage />
    </AuthProvider>,
  );
}

describe('JoinPage', () => {
  it('offers an account to someone who has none', async () => {
    mockFetch([[/\/session\/refresh$/, { status: 401, body: {} }]]);
    renderPage();

    // The invited newcomer is the primary case, and they arrive with nothing.
    expect(
      await screen.findByText('Sign in to use your invitation'),
    ).toBeTruthy();
    const create = screen.getByRole('link', { name: 'Create an account' });
    expect(create.getAttribute('href')).toBe('/register?next=join');
  });

  it('shows who is inviting and to what before spending the code', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TENANTLESS_SESSION }],
      [
        /\/people\/invitations\/preview$/,
        {
          status: 200,
          body: {
            organizationId: 'org-1',
            organizationName: 'Acme Retail',
            roleTemplate: 'agent',
            expiresAt: '2026-08-09T12:00:00.000Z',
          },
        },
      ],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Invitation code'), {
      target: { value: 'inv-1.secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Acme Retail')).toBeTruthy();
    expect(screen.getByText('Technician')).toBeTruthy();
    // Previewing must not spend it.
    expect(calls.some((call) => call.url.endsWith('/accept'))).toBe(false);
  });

  it('refreshes the session after accepting, or the person still belongs nowhere', async () => {
    const calls = mockFetch([
      [
        /\/session\/refresh$/,
        [
          { status: 200, body: TENANTLESS_SESSION },
          { status: 200, body: JOINED_SESSION },
        ],
      ],
      [
        /\/people\/invitations\/preview$/,
        {
          status: 200,
          body: {
            organizationId: 'org-1',
            organizationName: 'Acme Retail',
            roleTemplate: 'agent',
            expiresAt: '2026-08-09T12:00:00.000Z',
          },
        },
      ],
      [
        /\/people\/invitations\/accept$/,
        {
          status: 200,
          body: {
            organizationId: 'org-1',
            roleTemplate: 'agent',
            membershipCreated: true,
          },
        },
      ],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Invitation code'), {
      target: { value: 'inv-1.secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Join Acme Retail' }),
    );

    expect(await screen.findByText('You are in — Acme Retail')).toBeTruthy();
    // Accepting does not re-mint the token; the refresh is what does.
    await waitFor(() =>
      expect(
        calls.filter((call) => call.url.endsWith('/session/refresh')).length,
      ).toBe(2),
    );
  });

  it('explains an acceptance that created no membership', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TENANTLESS_SESSION }],
      [
        /\/people\/invitations\/preview$/,
        {
          status: 200,
          body: {
            organizationId: 'org-1',
            organizationName: 'Acme Retail',
            roleTemplate: 'agent',
            expiresAt: '2026-08-09T12:00:00.000Z',
          },
        },
      ],
      [
        /\/people\/invitations\/accept$/,
        {
          status: 200,
          body: {
            organizationId: 'org-1',
            roleTemplate: 'organization_admin',
            membershipCreated: false,
          },
        },
      ],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Invitation code'), {
      target: { value: 'inv-1.secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Join Acme Retail' }),
    );

    // A person who already belonged keeps their role, and the screen says so
    // rather than implying something changed.
    expect(
      await screen.findByText(/nothing about your access changed/),
    ).toBeTruthy();
  });

  it('surfaces the generic refusal without inventing a reason', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: TENANTLESS_SESSION }],
      [
        /\/people\/invitations\/preview$/,
        {
          status: 409,
          body: { message: 'this invitation cannot be used' },
        },
      ],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Invitation code'), {
      target: { value: 'inv-1.secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Expired, revoked, already used and issuer-lost-standing all arrive as
    // this one message. The UI must not guess which.
    expect(
      await screen.findByText('this invitation cannot be used'),
    ).toBeTruthy();
  });
});
