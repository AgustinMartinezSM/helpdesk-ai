import React from 'react';
import { render, screen, within } from '@testing-library/react';
import LandingPage from '../src/app/(public)/page';

describe('Landing page', () => {
  it('renders the product headline and both hero CTAs', () => {
    render(<LandingPage />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe(
      'Support operations, improved by artificial intelligence.',
    );
    expect(
      screen.getByRole('link', { name: 'Explore the platform' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See how it works' })).toBeTruthy();
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
