import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import RegisterPage from '../src/app/(public)/register/page';

const push = jest.fn();
let searchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: null,
  user: { id: 'u1', email: 'nueva@empresa.com', roles: ['user'] },
};

interface Scripted {
  status: number;
  body: unknown;
}

function mockFetch(routes: Array<[RegExp, Scripted]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const match = routes.find(([pattern]) => pattern.test(url));
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
      <RegisterPage />
    </AuthProvider>,
  );
}

describe('RegisterPage', () => {
  beforeEach(() => {
    push.mockClear();
    searchParams = new URLSearchParams();
  });

  it('refuses a password shorter than the service would accept', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 401, body: {} }],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'nueva@empresa.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Use at least 12 characters.')).toBeTruthy();
    // Refused locally: no request goes out at all.
    expect(calls.some((call) => call.url.endsWith('/session/register'))).toBe(
      false,
    );
  });

  it('registers then signs in — two calls, in that order', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 401, body: {} }],
      [
        /\/session\/register$/,
        { status: 201, body: { id: 'u1', email: 'nueva@empresa.com' } },
      ],
      [/\/session\/login$/, { status: 200, body: SESSION }],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'nueva@empresa.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets'));
    const order = calls
      .map((call) => call.url)
      .filter((url) => /register|login/.test(url));
    expect(order[0]).toContain('/session/register');
    expect(order[1]).toContain('/session/login');
  });

  it('returns an invited newcomer to redemption instead of the ticket list', async () => {
    searchParams = new URLSearchParams('next=join');
    mockFetch([
      [/\/session\/refresh$/, { status: 401, body: {} }],
      [
        /\/session\/register$/,
        { status: 201, body: { id: 'u1', email: 'nueva@empresa.com' } },
      ],
      [/\/session\/login$/, { status: 200, body: SESSION }],
    ]);
    renderPage();

    // Only the intent travels in the URL — never the code itself.
    expect(
      await screen.findByText(/then you can use your invitation code/),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nueva@empresa.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/join'));
  });

  it('keeps a failed sign-in recoverable after the account was created', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 401, body: {} }],
      [
        /\/session\/register$/,
        { status: 201, body: { id: 'u1', email: 'nueva@empresa.com' } },
      ],
      [/\/session\/login$/, { status: 503, body: { message: 'Try again' } }],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'nueva@empresa.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-long-enough-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    // The account exists; the person is told, rather than the half-finished
    // state being hidden inside one response.
    expect(await screen.findByText('Try again')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
