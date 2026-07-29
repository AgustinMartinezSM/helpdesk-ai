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
  it('presents the project honestly with its principles and attribution', () => {
    render(<AboutPage />);

    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    for (const principle of [
      'Quality over speed',
      'Architecture before implementation',
      'Human control over AI suggestions',
      'Security as a product requirement',
      'Documentation as implementation',
      'Every decision must be defensible',
    ]) {
      expect(
        screen.getByRole('heading', { level: 3, name: principle }),
      ).toBeTruthy();
    }
    expect(
      screen.getByText('Designed and developed by Agustín Martínez.'),
    ).toBeTruthy();
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
    // All nine applications are listed.
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
    ]) {
      expect(screen.getByText(app)).toBeTruthy();
    }
    // The CI story is honest: first remote run is a milestone, not a claim.
    expect(
      screen.getByText(/first remote run is a planned milestone/),
    ).toBeTruthy();
  });
});
