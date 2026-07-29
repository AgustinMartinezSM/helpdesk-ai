import React from 'react';
import { render, screen, within } from '@testing-library/react';
import FeaturesPage from '../src/app/(public)/features/page';
import { CAPABILITY_AREAS } from '../src/lib/product-status';

function cardFor(name: string): HTMLElement {
  const card = screen
    .getByRole('heading', { level: 3, name })
    .closest('article');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

describe('Features page', () => {
  it('renders every capability area as a section heading', () => {
    render(<FeaturesPage />);

    for (const area of CAPABILITY_AREAS) {
      expect(
        screen.getByRole('heading', { level: 2, name: area.title }),
      ).toBeTruthy();
    }
  });

  it('labels shipped, api-only and planned capabilities honestly', () => {
    render(<FeaturesPage />);

    expect(
      within(cardFor('Ticket lifecycle')).getByText('Available'),
    ).toBeTruthy();
    expect(within(cardFor('Attachments')).getByText('Planned')).toBeTruthy();
    expect(
      within(cardFor('Notifications')).getByText('API ready'),
    ).toBeTruthy();
    expect(
      within(cardFor('Notifications')).getByText(/the product UI is planned/i),
    ).toBeTruthy();
  });

  it('renders every capability from the single source of truth', () => {
    render(<FeaturesPage />);

    for (const area of CAPABILITY_AREAS) {
      for (const capability of area.capabilities) {
        expect(
          screen.getByRole('heading', { level: 3, name: capability.name }),
        ).toBeTruthy();
      }
    }
  });
});
