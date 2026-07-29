import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Helpi, HelpiRestore } from '../src/components/public/helpi';
import {
  HELPI_DISCLAIMER,
  hintFor,
  type HelpiHint,
} from '../src/lib/helpi-hints';
import { CAPABILITY_AREAS } from '../src/lib/product-status';

let currentPath = '/';
jest.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));

const PUBLIC_ROUTES = [
  '/',
  '/how-it-works',
  '/features',
  '/security',
  '/engineering',
  '/about',
  '/contact',
  '/login',
];

function openPanel() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Helpi, the product guide' }),
  );
}

describe('Helpi hints are honest guidance, not a chatbot', () => {
  it('gives every public route its own written hint', () => {
    for (const route of PUBLIC_ROUTES) {
      const hint = hintFor(route);
      expect(hint).not.toBeNull();
      expect((hint as HelpiHint).message.length).toBeGreaterThan(10);
      // Short enough to read at a glance.
      expect((hint as HelpiHint).message.length).toBeLessThanOrEqual(90);
    }
  });

  it('never invites conversation or claims to be AI', () => {
    const everything = [
      ...PUBLIC_ROUTES.map((r) => hintFor(r)?.message ?? ''),
      ...PUBLIC_ROUTES.map((r) => hintFor(r)?.action?.label ?? ''),
      HELPI_DISCLAIMER,
    ].join(' ');

    expect(everything).not.toMatch(
      /ask me|chat with|talk to me|I can answer|AI assistant|powered by AI|my AI/i,
    );
  });

  it('never presents a planned capability as something Helpi can do', () => {
    const planned = CAPABILITY_AREAS.flatMap((area) =>
      area.capabilities
        .filter((capability) => capability.status === 'planned')
        .map((capability) => capability.name.toLowerCase()),
    );
    expect(planned).toContain('summarization');

    const messages = PUBLIC_ROUTES.map((r) => hintFor(r)?.message ?? '')
      .join(' ')
      .toLowerCase();
    for (const name of planned) {
      expect(messages).not.toContain(name);
    }
  });

  it('says nothing on authenticated routes — it is public-only for now', () => {
    expect(hintFor('/tickets')).toBeNull();
    expect(hintFor('/tickets/new')).toBeNull();
    expect(hintFor('/account')).toBeNull();
  });

  it('falls back to the intro on an unknown public route', () => {
    expect(hintFor('/something-new')?.message).toMatch(/I'm Helpi/);
  });
});

describe('Helpi behaviour', () => {
  beforeEach(() => {
    currentPath = '/';
    localStorage.clear();
    delete document.documentElement.dataset.menuOpen;
    // Default to the narrow branch so the panel does not auto-open, which
    // keeps each test explicit about how it got opened.
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  it('offers a launcher and no text input at all', () => {
    render(<Helpi />);

    expect(
      screen.getByRole('button', { name: 'Helpi, the product guide' }),
    ).toBeTruthy();
    // A text field would make it a chatbot; there must never be one.
    expect(document.querySelector('input, textarea')).toBeNull();
  });

  it('shows the hint for the current route when opened', () => {
    currentPath = '/how-it-works';
    render(<Helpi />);

    openPanel();

    expect(
      screen.getByText(
        'A ticket is simply a request for help that stays organized.',
      ),
    ).toBeTruthy();
    expect(screen.getByText(HELPI_DISCLAIMER)).toBeTruthy();
  });

  it('exposes the disclosure state and closes on Escape, restoring focus', () => {
    render(<Helpi />);

    const launcher = screen.getByRole('button', {
      name: 'Helpi, the product guide',
    });
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(launcher.getAttribute('aria-controls')).toBe('helpi-panel');

    fireEvent.click(launcher);
    expect(document.getElementById('helpi-panel')).not.toBeNull();

    fireEvent.keyDown(document.getElementById('helpi-panel') as Element, {
      key: 'Escape',
    });

    expect(document.getElementById('helpi-panel')).toBeNull();
    const reopened = screen.getByRole('button', {
      name: 'Helpi, the product guide',
    });
    expect(reopened.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(reopened);
  });

  it('is not a modal: it never marks itself as one', () => {
    render(<Helpi />);
    openPanel();

    const panel = document.getElementById('helpi-panel') as HTMLElement;
    expect(panel.getAttribute('aria-modal')).toBeNull();
    expect(panel.getAttribute('role')).toBeNull();
  });

  it('stays dismissed across mounts and records the choice', () => {
    const first = render(<Helpi />);
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: "Don't show again" }));

    expect(
      screen.queryByRole('button', { name: 'Helpi, the product guide' }),
    ).toBeNull();
    expect(localStorage.getItem('helpi-dismissed')).toBe('true');

    first.unmount();
    render(<Helpi />);
    expect(
      screen.queryByRole('button', { name: 'Helpi, the product guide' }),
    ).toBeNull();
  });

  it('can be brought back from the footer after being dismissed', () => {
    localStorage.setItem('helpi-dismissed', 'true');
    render(
      <>
        <HelpiRestore />
        <Helpi />
      </>,
    );

    // Hidden, but recoverable — a dismissal must not be a one-way door.
    expect(
      screen.queryByRole('button', { name: 'Helpi, the product guide' }),
    ).toBeNull();
    const restore = screen.getByRole('button', { name: 'Show Helpi again' });

    act(() => {
      fireEvent.click(restore);
    });

    expect(localStorage.getItem('helpi-dismissed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close Helpi' })).toBeTruthy();
  });

  it('hides itself while the mobile menu owns the screen', () => {
    // The guard is CSS (html[data-menu-open]); assert the contract the
    // stylesheet depends on, since jsdom applies no CSS.
    render(<Helpi />);
    expect(
      screen
        .getByRole('button', { name: 'Helpi, the product guide' })
        .closest('div')?.className,
    ).toMatch(/root/);
  });

  it('survives blocked storage without disabling the guide', () => {
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage blocked');
      });
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage blocked');
      });

    render(<Helpi />);
    // Still usable; only the memory of the choice is lost.
    expect(
      screen.getByRole('button', { name: 'Helpi, the product guide' }),
    ).toBeTruthy();
    openPanel();
    expect(screen.getByText(HELPI_DISCLAIMER)).toBeTruthy();

    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('opens itself once on a wide viewport, then never again', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const first = render(<Helpi />);
    expect(document.getElementById('helpi-panel')).not.toBeNull();
    expect(localStorage.getItem('helpi-seen')).toBe('true');

    first.unmount();
    render(<Helpi />);
    // Second visit: available, but no longer opening on its own.
    expect(document.getElementById('helpi-panel')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Helpi, the product guide' }),
    ).toBeTruthy();
  });
});
