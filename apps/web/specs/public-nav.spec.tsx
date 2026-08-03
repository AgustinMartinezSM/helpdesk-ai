import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import { PublicNav } from '../src/components/public/public-nav';

let currentPath = '/';
jest.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: 'org-1',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

function mockSession(status: number, body: unknown = {}) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

function renderNav() {
  return render(
    <AuthProvider>
      <PublicNav />
    </AuthProvider>,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
  return screen.getByRole('dialog', { name: 'Site menu' });
}

describe('PublicNav', () => {
  beforeEach(() => {
    currentPath = '/';
    mockSession(401);
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

  it('marks the current route with aria-current in both navigations', async () => {
    currentPath = '/features';
    renderNav();

    const desktopActive = (
      await screen.findAllByRole('link', { name: 'Features' })
    ).find((link) => link.getAttribute('aria-current') === 'page');
    expect(desktopActive).toBeTruthy();
    expect(
      screen
        .getAllByRole('link', { name: 'Security' })
        .every((link) => link.getAttribute('aria-current') === null),
    ).toBe(true);

    const panel = openMenu();
    const mobileActive = Array.from(
      panel.querySelectorAll('a[aria-current="page"]'),
    ).map((link) => link.textContent);
    expect(mobileActive).toEqual(['Features']);
  });

  it('exposes the mobile menu as a modal dialog and makes the page behind inert', async () => {
    // The layout landmarks the nav hides while the panel is open.
    const main = document.createElement('main');
    main.id = 'main-content';
    const footer = document.createElement('footer');
    document.body.append(main, footer);

    renderNav();
    await screen.findByRole('button', { name: 'Open menu' });

    const panel = openMenu();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(document.body.style.overflow).toBe('hidden');
    expect(main.inert).toBe(true);
    expect(footer.inert).toBe(true);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

    expect(document.body.style.overflow).not.toBe('hidden');
    expect(main.inert).toBe(false);
    expect(footer.inert).toBe(false);
    main.remove();
    footer.remove();
  });

  it('moves focus into the panel and returns it to the toggle on Escape', async () => {
    renderNav();
    await screen.findByRole('button', { name: 'Open menu' });

    const panel = openMenu();
    expect(panel.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('keeps Tab inside the header and panel while the menu is open', async () => {
    renderNav();
    await screen.findByRole('button', { name: 'Open menu' });
    const panel = openMenu();

    // Reachable = not inside an inert subtree (the hidden desktop row is
    // marked inert), which is exactly what the component cycles through.
    const root = document.querySelector('header')!.parentElement!;
    const trapped = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    ).filter((element) => element.closest('[inert]') === null);

    // The hidden desktop navigation must not be part of the cycle.
    expect(trapped.some((element) => panel.contains(element))).toBe(true);
    expect(
      trapped.filter((element) => element.textContent === 'Features'),
    ).toHaveLength(1);

    const first = trapped[0];
    const last = trapped[trapped.length - 1];

    // Forward from the last focusable wraps to the first.
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // Backward from the first wraps to the last.
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes the menu and restores focus when a menu link is activated', async () => {
    renderNav();
    await screen.findByRole('button', { name: 'Open menu' });
    const panel = openMenu();

    // Activating the current-page link performs no navigation, so the
    // component itself must close and hand focus back.
    fireEvent.click(within(panel).getByRole('link', { name: 'Product' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open menu' }),
    );
  });

  it('offers a single Sign in call to action to anonymous visitors', async () => {
    renderNav();

    const signIn = await screen.findAllByRole('link', { name: 'Sign in' });
    expect(signIn.length).toBeGreaterThan(0);
    for (const link of signIn) {
      expect(link.getAttribute('href')).toBe('/login');
    }
    // No CTA promising a demo that does not exist.
    expect(
      screen.queryByRole('link', { name: 'Explore the platform' }),
    ).toBeNull();
  });

  it('switches the call to action to the app for signed-in visitors', async () => {
    mockSession(200, SESSION);
    renderNav();

    const openApp = await screen.findAllByRole('link', { name: 'Open app' });
    expect(openApp[0].getAttribute('href')).toBe('/tickets');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});

describe('PublicNav route changes', () => {
  it('closes an open menu when the route changes', async () => {
    currentPath = '/';
    mockSession(401);
    const { rerender } = render(
      <AuthProvider>
        <PublicNav />
      </AuthProvider>,
    );
    await screen.findByRole('button', { name: 'Open menu' });
    openMenu();
    expect(screen.getByRole('dialog')).toBeTruthy();

    currentPath = '/features';
    rerender(
      <AuthProvider>
        <PublicNav />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
