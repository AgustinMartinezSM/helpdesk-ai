import React from 'react';
import { render, screen, within } from '@testing-library/react';
import LandingPage from '../src/app/(public)/page';
import { CAPABILITY_AREAS, PROJECT_STATUS } from '../src/lib/product-status';

describe('Landing page', () => {
  it('renders the product headline and hero CTAs that lead somewhere real', () => {
    render(<LandingPage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(
      'Support operations, improved by artificial intelligence.',
    );
    expect(screen.getByRole('link', { name: 'See how it works' })).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Explore the architecture' }),
    ).toBeTruthy();
  });

  it('never promises a hosted demo the project does not have', () => {
    render(<LandingPage />);

    const body = document.body.textContent ?? '';
    // Affirmative promises only — the honest disclaimer below is allowed to
    // use the same words to deny them.
    expect(body).not.toMatch(
      /(sign in to|try) the (live |hosted )?demo|try it (now|free)/i,
    );
    // …and says plainly where the application actually runs.
    expect(body).toContain('there is no hosted demo yet');
  });

  it('qualifies the simulated AI output in the hero', () => {
    render(<LandingPage />);

    // The hero mock shows illustrative category/priority/summary values, not
    // a captured answer; the panel must carry its own qualifier, since the
    // scene is hidden from assistive tech and cannot rely on surrounding copy.
    const aiPanel = screen.getByText('AI analysis').closest('p');
    expect(aiPanel).not.toBeNull();
    expect(within(aiPanel as HTMLElement).getByText('API ready')).toBeTruthy();
  });

  it('never presents AI capabilities as available', () => {
    render(<LandingPage />);

    // The four capabilities the AI service implements are API ready: the
    // service, the panel and the Gemini adapter all exist, but a deployment
    // has to supply provider credentials before any of it answers. Duplicate
    // detection has not been started. Neither may ever read as "Available".
    //
    // The labels are written out rather than read from product-status.ts on
    // purpose — deriving them would make this test agree with any change,
    // and the point is to make a status promotion a deliberate edit.
    const expectations: Array<[name: string, label: string]> = [
      ['Summarization', 'API ready'],
      ['Classification', 'API ready'],
      ['Priority suggestion', 'API ready'],
      ['Suggested replies', 'API ready'],
      ['Duplicate detection', 'Planned'],
    ];

    for (const [aiCapability, label] of expectations) {
      const card = screen
        .getByRole('heading', { level: 3, name: aiCapability })
        .closest('article');
      expect(card).not.toBeNull();
      const scoped = within(card as HTMLElement);
      expect(scoped.getByText(label)).toBeTruthy();
      expect(scoped.queryByText('Available')).toBeNull();
    }
  });

  it('keeps the qualifying note on every AI card', () => {
    render(<LandingPage />);

    // The note is where a card admits what it does not do — that applying a
    // classification is manual, that a priority is never written back. This
    // reads the expected text from product-status.ts rather than hardcoding
    // it, so rewording a note is free but silently dropping one is not.
    const aiCapabilities =
      CAPABILITY_AREAS.find((area) => area.key === 'ai-assistance')
        ?.capabilities ?? [];
    expect(aiCapabilities.length).toBeGreaterThan(0);

    for (const capability of aiCapabilities) {
      expect(capability.note).toBeTruthy();
      const card = screen
        .getByRole('heading', { level: 3, name: capability.name })
        .closest('article');
      expect(
        within(card as HTMLElement).getByText(capability.note as string),
      ).toBeTruthy();
    }
  });

  it('shows the honest project status columns', () => {
    render(<LandingPage />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Implemented' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Planned' }),
    ).toBeTruthy();

    // Every declared group must render and must carry at least one item.
    // This catches a group left behind empty; it cannot catch a group whose
    // items are wrong, because it reads them from the same module the page
    // does. Omitting an empty group is a data-authoring rule in
    // product-status.ts, not something the renderer enforces.
    for (const group of PROJECT_STATUS) {
      expect(group.items.length).toBeGreaterThan(0);
      expect(
        screen.getByRole('heading', { level: 3, name: group.title }),
      ).toBeTruthy();
    }
  });

  it('describes the architecture flow accessibly', () => {
    render(<LandingPage />);

    expect(
      screen.getAllByRole('img', { name: /Request flow/ }).length,
    ).toBeGreaterThan(0);
  });
});
