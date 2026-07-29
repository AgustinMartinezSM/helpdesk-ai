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
    // Compliance certifications appear only inside the not-claimed list.
    expect(screen.getByText('SOC 2 or ISO 27001 certification')).toBeTruthy();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: 'What this project does not claim',
      }),
    ).toBeTruthy();
    // The security roadmap is explicitly labeled Planned.
    expect(screen.getByText('Planned')).toBeTruthy();
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
