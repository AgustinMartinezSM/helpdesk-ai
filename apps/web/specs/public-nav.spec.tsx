import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import { PublicNav } from '../src/components/public/public-nav';

let currentPath = '/';
jest.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));

function mockAnonymousSession() {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

function renderNav() {
  return render(
    <AuthProvider>
      <PublicNav />
    </AuthProvider>,
  );
}

describe('PublicNav', () => {
  beforeEach(() => {
    currentPath = '/';
    mockAnonymousSession();
  });

  it('renders the brand and the product navigation', async () => {
    renderNav();

    expect(screen.getByRole('link', { name: 'HelpDesk AI' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const label of [
      'Product',
      'How it works',
      'Features',
      'Security',
      'Engineering',
      'About',
      'Contact',
    ]) {
      expect(
        (await screen.findAllByRole('link', { name: label })).length,
      ).toBeGreaterThan(0);
    }
    expect(nav).toBeTruthy();
  });

  it('marks the current route with aria-current', async () => {
    currentPath = '/features';
    renderNav();

    const active = (
      await screen.findAllByRole('link', { name: 'Features' })
    ).find((link) => link.getAttribute('aria-current') === 'page');
    expect(active).toBeTruthy();
    const inactive = screen
      .getAllByRole('link', { name: 'Security' })
      .every((link) => link.getAttribute('aria-current') === null);
    expect(inactive).toBe(true);
  });

  it('opens the mobile menu, moves focus into it and closes on Escape', async () => {
    renderNav();

    const toggle = await screen.findByRole('button', { name: 'Open menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    const closeToggle = screen.getByRole('button', { name: 'Close menu' });
    expect(closeToggle.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById('public-mobile-menu');
    expect(panel).not.toBeNull();
    // Focus moved to the first focusable inside the panel.
    expect(panel?.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

    expect(document.getElementById('public-mobile-menu')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Open menu' })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    // Focus returned to the toggle.
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open menu' }),
    );
  });

  it('shows Sign in and the primary CTA to anonymous visitors', async () => {
    renderNav();

    expect(
      (await screen.findAllByRole('link', { name: 'Sign in' })).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('link', { name: 'Explore the platform' }).length,
    ).toBeGreaterThan(0);
  });
});
