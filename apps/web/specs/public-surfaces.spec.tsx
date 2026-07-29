import React from 'react';
import { render, screen } from '@testing-library/react';
import LandingPage from '../src/app/(public)/page';
import FeaturesPage from '../src/app/(public)/features/page';
import HowItWorksPage from '../src/app/(public)/how-it-works/page';
import { Section } from '../src/components/public/section';

describe('Section tones', () => {
  it('exposes its tone so surfaces can be verified, not assumed', () => {
    const { container } = render(
      <Section tone="tinted" title="Tinted">
        <p>content</p>
      </Section>,
    );

    const section = container.querySelector('section');
    expect(section?.getAttribute('data-tone')).toBe('tinted');
  });

  it('defaults to the page surface when no tone is given', () => {
    const { container } = render(
      <Section title="Plain">
        <p>content</p>
      </Section>,
    );

    expect(container.querySelector('section')?.getAttribute('data-tone')).toBe(
      'default',
    );
  });
});

function tonesOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll('section[data-tone]')].map(
    (section) => section.getAttribute('data-tone') as string,
  );
}

describe('Public pages alternate surfaces', () => {
  it('never places two identical tones back to back on the landing page', () => {
    const { container } = render(<LandingPage />);

    const tones = tonesOf(container);
    expect(tones.length).toBeGreaterThan(3);
    for (let i = 1; i < tones.length; i++) {
      expect(tones[i]).not.toBe(tones[i - 1]);
    }
  });

  it('never places two identical tones back to back on features', () => {
    const { container } = render(<FeaturesPage />);

    const tones = tonesOf(container);
    // Without this guard the loop below is vacuous on an empty list.
    expect(tones.length).toBeGreaterThan(3);
    for (let i = 1; i < tones.length; i++) {
      expect(tones[i]).not.toBe(tones[i - 1]);
    }
  });

  it('never places two identical tones back to back on how it works', () => {
    const { container } = render(<HowItWorksPage />);

    const tones = tonesOf(container);
    // Without this guard the loop below is vacuous on an empty list.
    expect(tones.length).toBeGreaterThan(3);
    for (let i = 1; i < tones.length; i++) {
      expect(tones[i]).not.toBe(tones[i - 1]);
    }
  });
});

describe('Landing page structure survives the visual work', () => {
  it('keeps one h1 and a valid heading order', () => {
    const { container } = render(<LandingPage />);

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const levels = [...container.querySelectorAll('h1, h2, h3')].map((node) =>
      Number(node.tagName[1]),
    );
    // No level is ever skipped on the way down.
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('marks every decorative layer as hidden from assistive tech', () => {
    const { container } = render(<LandingPage />);

    for (const cls of ['heroGlow', 'heroGrid']) {
      const layer = container.querySelector(`[class*="${cls}"]`);
      expect(layer).not.toBeNull();
      expect(layer?.getAttribute('aria-hidden')).toBe('true');
      // Decorative layers carry no text of their own.
      expect(layer?.textContent).toBe('');
    }
  });

  it('still states there is no hosted demo', () => {
    render(<LandingPage />);

    expect(screen.getByText(/there is no hosted demo yet/)).toBeTruthy();
  });
});
