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
    // The lead — not the heading — must carry the actual explanation, so
    // assert on the lead paragraph alone. (Asserting on the header's
    // combined text passes on the heading's own words and proves nothing.)
    const lead = [...(definition.parentElement?.querySelectorAll('p') ?? [])]
      .map((p) => p.textContent ?? '')
      .find((text) => text.includes('“ticket” means'));
    expect(lead).toBeDefined();
    expect(lead).toMatch(/status/i);
    expect(lead).toMatch(/conversation/i);
    expect(lead).toMatch(/history/i);
    expect(lead).not.toMatch(/DTO|RabbitMQ|PostgreSQL|httpOnly|BFF/);
  });

  it('keeps exactly one h1 and a heading order that never skips a level', () => {
    const { container } = render(<HowItWorksPage />);

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const levels = [...container.querySelectorAll('h1, h2, h3')].map((node) =>
      Number(node.tagName[1]),
    );
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
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
    // And a real ending: the team resolves, the requester confirms and it
    // closes — the product's central claim, so the example must show it.
    expect(scoped.getByText(/access was restored/i)).toBeTruthy();
    expect(
      scoped.getByText(/Resolved — waiting for Marina to confirm/),
    ).toBeTruthy();
    expect(scoped.getByText(/the payments went through/i)).toBeTruthy();
    expect(scoped.getByText(/Closed — Marina confirmed it/)).toBeTruthy();
  });

  it('never labels the resolved state as already confirmed', () => {
    render(<HowItWorksPage />);

    // "Resolved" means waiting for the requester; only "Closed" is
    // confirmed. The example used to contradict the lifecycle list.
    expect(document.body.textContent).not.toMatch(/Resolved — fix confirmed/);
  });
});

describe('How it works — AI section stays honest', () => {
  it('qualifies the AI suggestions and says what is still missing', () => {
    render(<HowItWorksPage />);

    const aiSection = screen
      .getByRole('heading', {
        level: 2,
        name: /It reads the repetitive part, a person decides the rest/,
      })
      .closest('section');
    expect(aiSection).not.toBeNull();
    const scoped = within(aiSection as HTMLElement);

    // The four implemented tasks are in development, duplicate detection is
    // not started, and the missing piece is named rather than glossed over.
    expect(scoped.getAllByText('In development').length).toBeGreaterThan(0);
    expect(scoped.getAllByText('Planned').length).toBeGreaterThan(0);
    expect(
      scoped.getByText(/not connected yet is a language model/i),
    ).toBeTruthy();
    expect(scoped.queryByText('Available')).toBeNull();
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
      name: /Explore the engineering/,
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
