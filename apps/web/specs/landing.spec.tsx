import React from 'react';
import { render, screen, within } from '@testing-library/react';
import LandingPage from '../src/app/(public)/page';

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

  it('marks the simulated AI output in the hero as Planned', () => {
    render(<LandingPage />);

    // The hero mock shows category/priority/summary suggestions that do not
    // exist yet; the panel must carry its own qualifier, since the scene is
    // hidden from assistive tech and cannot rely on surrounding copy.
    const aiPanel = screen.getByText('AI analysis').closest('p');
    expect(aiPanel).not.toBeNull();
    expect(within(aiPanel as HTMLElement).getByText('Planned')).toBeTruthy();
  });

  it('never presents AI capabilities as available', () => {
    render(<LandingPage />);

    for (const aiCapability of [
      'Summarization',
      'Classification',
      'Priority suggestion',
      'Suggested replies',
      'Duplicate detection',
    ]) {
      const card = screen
        .getByRole('heading', { level: 3, name: aiCapability })
        .closest('article');
      expect(card).not.toBeNull();
      expect(within(card as HTMLElement).getByText('Planned')).toBeTruthy();
    }
  });

  it('shows the honest project status columns', () => {
    render(<LandingPage />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Implemented' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: 'In development' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Planned' }),
    ).toBeTruthy();
  });

  it('describes the architecture flow accessibly', () => {
    render(<LandingPage />);

    expect(
      screen.getAllByRole('img', { name: /Request flow/ }).length,
    ).toBeGreaterThan(0);
  });
});
