import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Helpi, HelpiRestore } from '../src/components/helpi';
import {
  APP_ROUTE_PREFIXES,
  HELPI_DISCLAIMER,
  HELPI_INTRO,
  hintFor,
  type HelpiHint,
} from '../src/lib/helpi-hints';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Every authenticated route that has a hint. `/tickets/<id>` is covered by
 * the pattern rather than by this list, and `/join` is here because someone
 * redeeming an invitation is inside the app even though they are not a
 * member yet.
 */
const APP_ROUTES = [
  '/tickets',
  '/tickets/new',
  '/account',
  '/organization',
  '/people',
  '/join',
];

const ALL_ROUTES = [...PUBLIC_ROUTES, ...APP_ROUTES];

function openPanel() {
  fireEvent.click(
    screen.getByRole('button', { name: 'Helpi, la guía del producto' }),
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

    /**
     * Both languages. The English list alone would have guarded nothing
     * once the copy became Spanish — a passing test asserting about strings
     * that no longer exist is worse than no test, because it reads as
     * coverage.
     */
    expect(everything).not.toMatch(
      /ask me|chat with|talk to me|I can answer|AI assistant|powered by AI|my AI/i,
    );
    expect(everything).not.toMatch(
      /pregunt(ame|á|as)|chate(á|a) conmigo|habl(á|a) conmigo|te respondo|asistente de ia|con inteligencia artificial/i,
    );
  });

  it('never presents a capability Helpi cannot deliver, on ANY route', () => {
    /**
     * This used to scan public routes only, which left the one hint that
     * mentioned AI — the ticket detail's "AI drafts for staff" — permanently
     * unchecked. It was also the only hint that overstated. A guard whose
     * blind spot is exactly where the problem lives is not a guard.
     *
     * The bar is `available`, not `planned`: a capability that needs
     * credentials nobody has supplied is not something Helpi can point at
     * either, even though it exists.
     */
    const unavailable = CAPABILITY_AREAS.flatMap((area) =>
      area.capabilities
        .filter((capability) => capability.status !== 'available')
        .map((capability) => capability.name.toLowerCase()),
    );
    // Sanity check on the fixture itself: if everything became available,
    // this test would pass while checking nothing.
    expect(unavailable).toContain('duplicate detection');

    const messages = [
      ...ALL_ROUTES.map((r) => hintFor(r)?.message ?? ''),
      hintFor('/tickets/25556001-c028-4f75-bb66-25197de840c6')?.message ?? '',
    ]
      .join(' ')
      .toLowerCase();
    for (const name of unavailable) {
      expect(messages).not.toContain(name);
    }
  });

  it('says nothing about AI anywhere, in either language', () => {
    // Helpi is not AI and does not speak for the AI capabilities. The panel
    // on the ticket does that, with the provider named and a notice when no
    // model is connected.
    const everything = [
      ...ALL_ROUTES.map((r) => hintFor(r)?.message ?? ''),
      hintFor('/tickets/abc-123')?.message ?? '',
      HELPI_DISCLAIMER,
    ]
      .join(' ')
      // The product's NAME contains the two letters, and Helpi is allowed to
      // say the name of the product it guides. What it may not do is talk
      // about the capability.
      .replace(/HelpDesk AI/g, 'HelpDesk');
    expect(everything).not.toMatch(/\bia\b|inteligencia artificial|\bai\b/i);
  });

  it('gives every authenticated route with a screen its own hint', () => {
    /**
     * `/organization` had no hint and no prefix guard, so it fell through to
     * the public marketing intro: an administrator configuring branches was
     * told "let me show you how HelpDesk AI works" and offered a link off
     * the product. Every app route now either has a hint or is silent by a
     * rule somebody wrote down.
     */
    for (const route of APP_ROUTES) {
      const hint = hintFor(route);
      expect({ route, hasHint: hint !== null }).toEqual({
        route,
        hasHint: true,
      });
      expect((hint as HelpiHint).message).not.toBe(HELPI_INTRO);
    }
  });

  it('covers every authenticated route prefix, so none can fall through', () => {
    // The list the fallback consults, checked against the routes that exist.
    for (const route of APP_ROUTES) {
      expect(
        APP_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix)),
      ).toBe(true);
    }
  });

  it('writes its Spanish in voseo rather than tuteo', () => {
    /**
     * Objective enough to be worth asserting: the tuteo imperatives of the
     * verbs this copy actually uses. "Contá" not "cuenta", "pegá" not
     * "pega", "invitá" not "invita", "usá" not "usa", "empezá" not
     * "empieza". A wider check would fight Spanish; these are the words on
     * screen.
     */
    const messages = [
      ...ALL_ROUTES.map((r) => hintFor(r)?.message ?? ''),
      ...ALL_ROUTES.map((r) => hintFor(r)?.action?.label ?? ''),
    ].join(' ');

    expect(messages).not.toMatch(
      /\b(cuenta el|pega el|invita a|usa los|empieza por|fíjate)/i,
    );
    /**
     * And it really is Spanish, so the check above is not vacuous.
     *
     * No trailing \b: in JavaScript regex an accented vowel is not a word
     * character, so /contá\b/ requires a WORD character after the "á" and
     * therefore never matches "Contá el". That cost a debugging round and
     * is the kind of thing worth writing down rather than rediscovering.
     */
    expect(messages).toMatch(/\b(contá|pegá|invitá|usá|empezá)/i);
  });

  it('guides the authenticated app routes too', () => {
    expect(hintFor('/tickets')?.message).toMatch(/filtros/i);
    expect(hintFor('/tickets/new')?.message).toMatch(/con tus palabras/i);
    expect(hintFor('/account')?.message).toMatch(/permisos/i);
    expect(hintFor('/organization')?.message).toMatch(/equipos de soporte/i);
  });

  it('matches the ticket detail route by pattern, not by guessing', () => {
    const detail = hintFor('/tickets/25556001-c028-4f75-bb66-25197de840c6');
    expect(detail?.message).toMatch(/respuestas, estado e historial/);
    // /tickets/new must win over the dynamic pattern.
    expect(hintFor('/tickets/new')?.message).not.toMatch(/respuestas, estado/);
  });

  it('stays quiet on an unknown authenticated route', () => {
    // Guessing inside a tool someone is working in is worse than silence.
    expect(hintFor('/tickets/abc/extra')).toBeNull();
    expect(hintFor('/account/settings')).toBeNull();
  });

  it('falls back to the intro on an unknown public route', () => {
    expect(hintFor('/something-new')?.message).toMatch(/Soy Helpi/);
  });

  it('keeps app hints within the same length budget', () => {
    for (const route of [...APP_ROUTES]) {
      const message = hintFor(route)?.message ?? '';
      expect(message.length).toBeGreaterThan(10);
      expect(message.length).toBeLessThanOrEqual(90);
    }
  });
});

describe('Helpi never looks like the thing it is not', () => {
  const SOURCE = readFileSync(
    join(__dirname, '..', 'src', 'components', 'helpi.tsx'),
    'utf8',
  );

  it('uses the compass and never the sparkle', () => {
    /**
     * Orientation, not conversation. SparklesIcon is reserved for the AI
     * capabilities, and Helpi carrying one would say the opposite of the
     * constraint it exists under. The design system stated this rule with
     * the same force as the not-a-chatbot rule; only the other one had a
     * test, which is how a rule becomes a suggestion.
     */
    expect(SOURCE).toContain('CompassIcon');
    expect(SOURCE).not.toContain('SparklesIcon');
  });

  it('draws no speech bubble', () => {
    // The silhouette of a floating circle in a corner already says "chat
    // with us" to anyone who has used the web. The glyph inside it is the
    // only thing that can say otherwise, so it must not help.
    expect(SOURCE).not.toContain('MessageSquareIcon');
    expect(SOURCE).not.toContain('MessageCircleIcon');
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
      screen.getByRole('button', { name: 'Helpi, la guía del producto' }),
    ).toBeTruthy();
    // A text field would make it a chatbot; there must never be one.
    expect(document.querySelector('input, textarea')).toBeNull();
  });

  it('shows the hint for the current route when opened', () => {
    currentPath = '/how-it-works';
    render(<Helpi />);

    openPanel();

    expect(
      screen.getByText('Un ticket es un pedido de ayuda que queda ordenado.'),
    ).toBeTruthy();
    expect(screen.getByText(HELPI_DISCLAIMER)).toBeTruthy();
  });

  it('exposes the disclosure state and closes on Escape, restoring focus', () => {
    render(<Helpi />);

    const launcher = screen.getByRole('button', {
      name: 'Helpi, la guía del producto',
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
      name: 'Helpi, la guía del producto',
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
    fireEvent.click(screen.getByRole('button', { name: 'No mostrar más' }));

    expect(
      screen.queryByRole('button', { name: 'Helpi, la guía del producto' }),
    ).toBeNull();
    expect(localStorage.getItem('helpi-dismissed')).toBe('true');

    first.unmount();
    render(<Helpi />);
    expect(
      screen.queryByRole('button', { name: 'Helpi, la guía del producto' }),
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
      screen.queryByRole('button', { name: 'Helpi, la guía del producto' }),
    ).toBeNull();
    const restore = screen.getByRole('button', {
      name: 'Mostrar Helpi de nuevo',
    });

    act(() => {
      fireEvent.click(restore);
    });

    expect(localStorage.getItem('helpi-dismissed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cerrar Helpi' })).toBeTruthy();
  });

  it('anchors left inside the app so it clears the primary buttons', () => {
    currentPath = '/tickets';
    const { container } = render(<Helpi side="left" />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/left/);
  });

  it('closes when the page is tapped or scrolled, so it never sits in the way', () => {
    render(<Helpi />);
    openPanel();
    expect(document.getElementById('helpi-panel')).not.toBeNull();

    // Measured at 375px: the open panel overlaps the comment textarea on
    // the ticket detail, so it must yield to the first tap outside it.
    fireEvent.pointerDown(document.body);
    expect(document.getElementById('helpi-panel')).toBeNull();

    openPanel();
    expect(document.getElementById('helpi-panel')).not.toBeNull();
    fireEvent.scroll(window);
    expect(document.getElementById('helpi-panel')).toBeNull();
  });

  it('stays open when the tap lands inside it', () => {
    render(<Helpi />);
    openPanel();

    const panel = document.getElementById('helpi-panel') as HTMLElement;
    fireEvent.pointerDown(panel);
    expect(document.getElementById('helpi-panel')).not.toBeNull();
  });

  it('gets out of the way while someone is typing', () => {
    currentPath = '/tickets/new';
    render(
      <>
        <textarea aria-label="Description" />
        <Helpi side="left" />
      </>,
    );

    expect(
      screen.getByRole('button', { name: 'Helpi, la guía del producto' }),
    ).toBeTruthy();

    // A floating element must never sit over the field being used.
    fireEvent.focusIn(screen.getByLabelText('Description'));
    expect(
      screen.queryByRole('button', { name: 'Helpi, la guía del producto' }),
    ).toBeNull();

    fireEvent.focusOut(screen.getByLabelText('Description'));
    expect(
      screen.getByRole('button', { name: 'Helpi, la guía del producto' }),
    ).toBeTruthy();
  });

  it('hides itself while the mobile menu owns the screen', () => {
    // The guard is CSS (html[data-menu-open]); assert the contract the
    // stylesheet depends on, since jsdom applies no CSS.
    render(<Helpi />);
    expect(
      screen
        .getByRole('button', { name: 'Helpi, la guía del producto' })
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
      screen.getByRole('button', { name: 'Helpi, la guía del producto' }),
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
      screen.getByRole('button', { name: 'Helpi, la guía del producto' }),
    ).toBeTruthy();
  });
});
