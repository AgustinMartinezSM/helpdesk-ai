import React from 'react';
import { render, screen } from '@testing-library/react';
import AboutPage from '../src/app/(public)/about/page';
import EngineeringPage from '../src/app/(public)/engineering/page';
import SecurityPage from '../src/app/(public)/security/page';

describe('Security page', () => {
  it('describes the real posture and lists what is not claimed', () => {
    render(<SecurityPage />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Security as a product requirement',
      }),
    ).toBeTruthy();

    // Certifications are named ONLY inside the not-claimed list — assert
    // the containment, not merely that the words appear somewhere.
    const notClaimed = screen
      .getByRole('heading', {
        level: 2,
        name: 'What this project does not claim',
      })
      .closest('section');
    expect(notClaimed).not.toBeNull();
    for (const claim of [
      'SOC 2 or ISO 27001 certification',
      'GDPR or HIPAA compliance programs',
      'Independent penetration testing',
    ]) {
      const node = screen.getByText(claim);
      expect(notClaimed?.contains(node)).toBe(true);
      // And exactly one occurrence, so it cannot also be claimed elsewhere.
      expect(screen.getAllByText(claim)).toHaveLength(1);
    }
    // The security roadmap is explicitly labeled Planned.
    expect(screen.getByText('Planned')).toBeTruthy();
  });

  it('describes authorization without contradicting the ticket lifecycle', () => {
    render(<SecurityPage />);

    const body = document.body.textContent ?? '';
    // Requesters really can close their own resolved tickets, so the page
    // must not claim every transition is staff-only.
    expect(body).not.toContain('ticket transitions are staff-only');
    expect(body).toContain('requesters may close only their own resolved');
  });
});

describe('About page', () => {
  it('is written in the first person throughout', () => {
    render(<AboutPage />);

    const body = document.body.textContent ?? '';
    // A handful of first-person markers spread across the page, not one
    // token in a single sentence.
    const firstPerson = body.match(/\b(I|My|me)\b/g) ?? [];
    expect(firstPerson.length).toBeGreaterThan(20);
    expect(body).toMatch(/I started this project/);
    expect(body).toMatch(/I wanted/);
  });

  it('contains no third-person biography patterns', () => {
    render(<AboutPage />);

    const body = document.body.textContent ?? '';
    for (const pattern of [
      /Agustín (created|wanted|built|designed|decided|believes)/,
      /The developer\b/,
      /The author\b/,
      /\bHe (created|designed|built|decided)\b/,
      /is a portfolio project by Agustín/,
      /was created by Agustín/,
    ]) {
      expect(body).not.toMatch(pattern);
    }
    // The name survives only as attribution.
    expect(body.match(/Agustín Martínez/g) ?? []).toHaveLength(1);
    expect(
      screen.getByText('Designed and developed by Agustín Martínez.'),
    ).toBeTruthy();
  });

  it('explains the real problem and my approach to AI in my own voice', () => {
    render(<AboutPage />);

    const body = document.body.textContent ?? '';
    // The scattered-requests problem.
    expect(body).toMatch(/direct message/i);
    expect(body).toMatch(/spreadsheet/i);
    expect(body).toMatch(/forgotten/i);
    // Why not a simpler build.
    expect(body).toMatch(/I could have built a form, a table and a database/);
    // AI as an assistant, stated personally.
    expect(body).toMatch(/What I do not want is for it to decide/);
  });

  it('invents no company, clients, funding or usage', () => {
    render(<AboutPage />);

    const body = document.body.textContent ?? '';
    expect(body).toMatch(/not a company and I am not pretending it is one/i);
    expect(body).not.toMatch(
      /our (customers|clients|team of)|funded by|trusted by|\d+ (companies|customers|users)/i,
    );
  });

  it('keeps exactly one h1 and a heading order that never skips a level', () => {
    const { container } = render(<AboutPage />);

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const levels = [...container.querySelectorAll('h1, h2, h3')].map((node) =>
      Number(node.tagName[1]),
    );
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('does not claim the repository is public while engineering says otherwise', () => {
    render(<AboutPage />);

    // /engineering states the repository is still local-only, so About
    // must not imply an open repository a visitor could go and read.
    expect(document.body.textContent).not.toMatch(/in the open/i);
  });

  it('keeps the working principles', () => {
    render(<AboutPage />);

    for (const principle of [
      'Quality over speed',
      'Architecture before implementation',
      'People decide, AI assists',
      'Security is part of the feature',
      'Every decision must be defensible',
    ]) {
      expect(
        screen.getByRole('heading', { level: 3, name: principle }),
      ).toBeTruthy();
    }
  });
});

describe('Engineering page', () => {
  it('shows the real architecture, decisions and honest CI status', () => {
    render(<EngineeringPage />);

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    for (const decision of [
      'Monorepo over polyrepo',
      'A BFF and a gateway — deliberately both',
      'Database per service',
      'HTTP for commands, events for facts',
      'Correlation ids now, tracing later',
      'Transactional outbox — deferred on purpose',
    ]) {
      expect(
        screen.getByRole('heading', { level: 3, name: decision }),
      ).toBeTruthy();
    }
    // All eleven applications are listed.
    for (const app of [
      'web',
      'web-bff',
      'api-gateway',
      'auth-service',
      'tickets-service',
      'users-service',
      'audit-service',
      'notification-service',
      'analytics-service',
      'ai-service',
      'organizations-service',
    ]) {
      expect(screen.getByText(app)).toBeTruthy();
    }
    // organizations-service exists and is listed, but nothing in the product
    // uses it yet — the page must never sell tenancy as a capability.
    expect(document.body.textContent).not.toMatch(
      /multi-?tenan|tenant isolation|per-organization/i,
    );
    // The CI story stays honest in both directions. It really has run on a
    // remote, so the page must not go back to claiming otherwise — and it
    // must not claim a deployment that still does not exist.
    expect(screen.getByText(/last remote run was green/)).toBeTruthy();
    expect(screen.getByText(/nothing is hosted yet/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(
      /repository is still local-only|never run on a remote/,
    );
    // A green pipeline is not a deployment, and the page has claimed more
    // than the pipeline delivered before: it once described a remote run
    // covering a project and suite count that had only ever run locally.
    // Deliberately no counts here — the page states what the run covered
    // without a number that goes stale the next time a service is added.
    expect(document.body.textContent).not.toMatch(
      /deployed|in production|live environment/i,
    );
  });
});
