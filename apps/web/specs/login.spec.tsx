import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import LoginPage from '../src/app/login/page';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

function mockFetchRoutes(
  routes: Record<string, { status: number; body: unknown }>,
) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(routes).find(([suffix]) =>
      url.endsWith(suffix),
    );
    const scripted = match?.[1] ?? { status: 404, body: {} };
    return {
      ok: scripted.status >= 200 && scripted.status < 300,
      status: scripted.status,
      json: async () => scripted.body,
    } as Response;
  }) as unknown as typeof fetch;
}

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

describe('LoginPage', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('signs in through the BFF and navigates to the account page', async () => {
    mockFetchRoutes({
      '/session/refresh': { status: 401, body: {} },
      '/session/login': { status: 200, body: SESSION },
    });

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'a-valid-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/account'));
  });

  it('shows the BFF error message when credentials are rejected', async () => {
    mockFetchRoutes({
      '/session/refresh': { status: 401, body: {} },
      '/session/login': {
        status: 401,
        body: { message: 'Invalid credentials' },
      },
    });

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    );

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'a@b.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Invalid credentials');
    expect(push).not.toHaveBeenCalled();
  });
});
