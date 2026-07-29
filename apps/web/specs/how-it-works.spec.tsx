import React from 'react';
import { render, screen, within } from '@testing-library/react';
import HowItWorksPage from '../src/app/(public)/how-it-works/page';

describe('How it works — plain language first', () => {
  it('defines what a ticket is before using the word as jargon', () => {
    render(<HowItWorksPage />);

    const definition = screen.getByRole('heading', {
      level: 2,
      name: /A ticket is just a request for help that stays organized/,
    });
    expect(definition).toBeTruthy();
    // The definition avoids implementation vocabulary entirely.
    const lead = definition.parentElement?.textContent ?? '';
    expect(lead).toMatch(/request for help/i);
    expect(lead).not.toMatch(/DTO|RabbitMQ|PostgreSQL|httpOnly|BFF/);
  });

  it('leads with the three parts in a user-first order', () => {
    render(<HowItWorksPage />);

    const eyebrows = screen
      .getAllByText(/^Part \d · /)
      .map((node) => node.textContent);
    expect(eyebrows).toEqual([
      'Part 1 · Using HelpDesk AI',
      'Part 2 · Where AI helps',
      'Part 3 · How the platform is built',
    ]);
  });

  it('shows the simple user journey', () => {
    render(<HowItWorksPage />);

    for (const step of [
      'Sign in',
      'Ask for help',
      'Talk it through',
      'Follow the status',
    ]) {
      expect(
        screen.getByRole('heading', { level: 3, name: step }),
      ).toBeTruthy();
    }
  });

  it('explains every lifecycle state in plain words', () => {
    render(<HowItWorksPage />);

    for (const label of ['Open', 'In progress', 'Resolved', 'Closed']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/waiting for the team to pick up/i)).toBeTruthy();
    // The requester keeps the final word.
    expect(screen.getByText(/closing it is your call/i)).toBeTruthy();
  });

  it('renders a complete worked example with both voices, states and a resolution', () => {
    render(<HowItWorksPage />);

    const example = screen
      .getByRole('heading', {
        level: 3,
        name: 'I cannot access the invoicing system',
      })
      .closest('figure');
    expect(example).not.toBeNull();
    const scoped = within(example as HTMLElement);

    // The user's words and the team's reply.
    expect(scoped.getByText(/My account appears to be locked/)).toBeTruthy();
    expect(
      scoped.getByText(/Could you confirm the exact message/),
    ).toBeTruthy();
    // Movement through states.
    expect(scoped.getByText(/Open — waiting for the team/)).toBeTruthy();
    expect(scoped.getByText(/In progress — someone is on it/)).toBeTruthy();
    // And an ending.
    expect(scoped.getByText(/access was restored/i)).toBeTruthy();
    expect(scoped.getByText(/Resolved — fix confirmed/)).toBeTruthy();
  });
});

describe('How it works — AI section stays honest', () => {
  it('marks the AI suggestions as Planned, never as working behavior', () => {
    render(<HowItWorksPage />);

    const aiSection = screen
      .getByRole('heading', {
        level: 2,
        name: /It reads the repetitive part, a person decides the rest/,
      })
      .closest('section');
    expect(aiSection).not.toBeNull();
    const scoped = within(aiSection as HTMLElement);

    expect(scoped.getAllByText('Planned').length).toBeGreaterThan(0);
    expect(scoped.getByText(/None of this is built yet/i)).toBeTruthy();
    // No claim of autonomous resolution anywhere on the page.
    expect(document.body.textContent).not.toMatch(
      /automatically (resolves|closes|assigns)|without human|fully autonomous/i,
    );
  });

  it('states explicitly that a person remains responsible', () => {
    render(<HowItWorksPage />);

    expect(
      screen.getByText(
        /AI suggestions are reviewed by a person\. The support team remains responsible for the final decision\./,
      ),
    ).toBeTruthy();
  });
});

describe('How it works — engineering stays a link, not the page', () => {
  it('keeps the architecture short and points to /engineering', () => {
    render(<HowItWorksPage />);

    const cta = screen.getByRole('link', {
      name: /Explore the engineering behind HelpDesk AI/,
    });
    expect(cta.getAttribute('href')).toBe('/engineering');
    // The deep technical vocabulary now lives on /engineering.
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/ticket\.created\.v1|DTO|httpOnly/);
  });

  it('still describes the architecture accessibly for those who read it', () => {
    render(<HowItWorksPage />);

    expect(screen.getByRole('img', { name: /Request flow/ })).toBeTruthy();
  });
});
