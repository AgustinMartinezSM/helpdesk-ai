import React from 'react';
import { render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/components/auth-context';

function Probe() {
  const { status, session } = useAuth();
  return (
    <p>
      {status}
      {session ? `:${session.user.email}` : ''}
    </p>
  );
}

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

describe('AuthProvider silent refresh', () => {
  it('recovers a session from the refresh cookie on mount', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => SESSION,
    })) as unknown as typeof fetch;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('authenticated:a@b.com')).toBeTruthy();
  });

  it('settles as anonymous when no session can be recovered', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText('anonymous')).toBeTruthy();
  });
});
