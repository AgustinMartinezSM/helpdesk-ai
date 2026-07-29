import React from 'react';
import { render, screen } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import Page from '../src/app/page';

describe('Landing page', () => {
  it('renders the product name as the main heading', async () => {
    // The hero CTA is session-aware, so the page now needs the provider;
    // an anonymous session keeps the assertion focused on the heading.
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    render(
      <AuthProvider>
        <Page />
      </AuthProvider>,
    );

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('HelpDesk AI');

    // Wait for the silent refresh to settle to avoid act() warnings.
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
  });
});
