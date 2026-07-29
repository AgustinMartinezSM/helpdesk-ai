import React from 'react';
import { render, screen, within } from '@testing-library/react';
import HowItWorksPage from '../src/app/(public)/how-it-works/page';

function stepFor(title: string): HTMLElement {
  const step = screen
    .getByRole('heading', { level: 3, name: title })
    .closest('li');
  expect(step).not.toBeNull();
  return step as HTMLElement;
}

describe('How it works page', () => {
  it('renders the full workflow with implemented steps labeled Available', () => {
    render(<HowItWorksPage />);

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(
      within(stepFor('A user submits a support request')).getByText(
        'Available',
      ),
    ).toBeTruthy();
    expect(
      within(stepFor('The technician acts — and stays responsible')).getByText(
        'Available',
      ),
    ).toBeTruthy();
  });

  it('labels every AI step as Planned, never as working behavior', () => {
    render(<HowItWorksPage />);

    for (const aiStep of [
      'AI analysis is requested asynchronously',
      'Category, priority and summary suggestions are generated',
      'A technician reviews the suggestions',
    ]) {
      expect(within(stepFor(aiStep)).getByText('Planned')).toBeTruthy();
    }
  });

  it('shows the real event contracts and an accessible lifecycle diagram', () => {
    render(<HowItWorksPage />);

    expect(screen.getByText('ticket.created.v1')).toBeTruthy();
    expect(screen.getByText('ticket.status-changed.v1')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Ticket lifecycle/ })).toBeTruthy();
  });
});
