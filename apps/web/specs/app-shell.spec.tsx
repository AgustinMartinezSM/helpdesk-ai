import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppShell } from '../src/components/app-shell';
import { AuthProvider } from '../src/components/auth-context';

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: 'org-1',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
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
  return calls;
}

function renderShell() {
  return render(
    <AuthProvider>
      <AppShell>
        <p>page content</p>
      </AppShell>
    </AuthProvider>,
  );
}

describe('AppShell', () => {
  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('offers Sign in to anonymous visitors', async () => {
    mockFetch({ '/session/refresh': { status: 401, body: {} } });

    renderShell();

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('page content')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tickets' })).toBeTruthy();
  });

  it('toggles the theme, persists it and exposes the pressed state', async () => {
    mockFetch({ '/session/refresh': { status: 401, body: {} } });
    document.documentElement.dataset.theme = 'light';

    renderShell();
    await screen.findByRole('link', { name: 'Sign in' });

    const toggle = screen.getByRole('button', { name: 'Dark theme' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(toggle);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the user menu with the email initial and signs out', async () => {
    const calls = mockFetch({
      '/session/refresh': { status: 200, body: SESSION },
      '/session/logout': { status: 204, body: {} },
    });

    renderShell();

    // Avatar carries the email initial; the menu lists account + sign out.
    expect(await screen.findByText('A')).toBeTruthy();
    expect(screen.getByText('a@b.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
    expect(calls.some((url) => url.endsWith('/session/logout'))).toBe(true);
  });
});
