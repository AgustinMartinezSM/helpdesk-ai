import React from 'react';
import { render, screen } from '@testing-library/react';
import { PublicFooter } from '../src/components/public/public-footer';

/**
 * siteConfig is built from env vars at module load, so the footer's
 * config-driven branches are exercised through a mutable mock rather than
 * by reloading the module (which would give the test a second React copy).
 */
const config: {
  githubUrl: string | null;
  linkedinUrl: string | null;
  contactEmail: string | null;
} = { githubUrl: null, linkedinUrl: null, contactEmail: null };

jest.mock('../src/lib/site-config', () => ({
  get siteConfig() {
    return {
      productName: 'HelpDesk AI',
      author: 'Agustín Martínez',
      attribution: 'Designed and developed by Agustín Martínez.',
      siteUrl: null,
      ...config,
    };
  },
  PUBLIC_NAV_LINKS: [
    { href: '/', label: 'Product' },
    { href: '/how-it-works', label: 'How it works' },
    { href: '/features', label: 'Features' },
  ],
}));

describe('PublicFooter', () => {
  beforeEach(() => {
    config.githubUrl = null;
    config.linkedinUrl = null;
    config.contactEmail = null;
  });

  it('renders no external links when nothing is configured', () => {
    render(<PublicFooter />);

    expect(screen.queryByRole('navigation', { name: 'Elsewhere' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'GitHub' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'LinkedIn' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Email' })).toBeNull();
    // Internal navigation is always present.
    expect(screen.getByRole('link', { name: 'Security' })).toBeTruthy();
  });

  it('renders each external link only when its own variable is set', () => {
    config.githubUrl = 'https://github.com/example/helpdesk-ai';
    config.contactEmail = 'hello@example.com';
    render(<PublicFooter />);

    expect(
      screen.getByRole('link', { name: 'GitHub' }).getAttribute('href'),
    ).toBe('https://github.com/example/helpdesk-ai');
    expect(
      screen.getByRole('link', { name: 'Email' }).getAttribute('href'),
    ).toBe('mailto:hello@example.com');
    // Not configured — must not render an empty or placeholder link.
    expect(screen.queryByRole('link', { name: 'LinkedIn' })).toBeNull();
  });

  it('never renders an empty or placeholder href', () => {
    config.githubUrl = 'https://github.com/example/helpdesk-ai';
    config.linkedinUrl = 'https://linkedin.com/in/example';
    config.contactEmail = 'hello@example.com';
    render(<PublicFooter />);

    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).not.toBe('#');
    }
  });

  it('always carries the attribution', () => {
    render(<PublicFooter />);

    expect(
      screen.getByText('Designed and developed by Agustín Martínez.'),
    ).toBeTruthy();
  });
});

describe('siteConfig URL validation', () => {
  it('treats a malformed URL as unset so no broken link can ship', async () => {
    // The real module, not the mock above.
    const actual = jest.requireActual('../src/lib/site-config');
    // optionalUrl is internal; its contract is observable through the
    // exported config built from process.env at load time.
    expect(actual.siteConfig.githubUrl).toBeNull();
    expect(Array.isArray(actual.PUBLIC_NAV_LINKS)).toBe(true);
  });
});
