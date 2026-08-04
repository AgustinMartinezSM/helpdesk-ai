import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeToggle } from '../src/components/theme-toggle';

const SRC = join(__dirname, '..', 'src');
const GLOBAL_CSS = readFileSync(join(SRC, 'app', 'global.css'), 'utf8');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? cssFiles(full)
      : entry.endsWith('.css')
        ? [full]
        : [];
  });
}

/**
 * Sprint 10.8, found by pressing the toggle in a real browser.
 *
 * A CSS `transition` on `color` whose value comes from a theme token NEVER
 * LANDS on the new value when the token changes: the element keeps the
 * PREVIOUS theme's colour indefinitely — measured unchanged at three seconds,
 * and snapping to the correct colour the instant the transition was removed.
 * Ten rules across the app shell, the public nav and footer, Helpi, the
 * landing page, the ticket detail and the theme button itself transition
 * `color`, so pressing the theme control repainted the page while leaving the
 * primary navigation in the other theme's ink: 2.36:1 on a near-white page,
 * against the 4.5:1 this design system holds itself to.
 *
 * jsdom computes no transitions, so this cannot be asserted by rendering. What
 * it CAN pin is the mechanism: the attribute that suppresses transitions is
 * set for the swap and cleared afterwards, and the rule that reads it exists.
 * That is the honest form of the check, and it is stated here rather than
 * implied so nobody later "simplifies" the double frame away.
 */
describe('a theme swap does not animate, and that is a correctness rule', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.themeSwitching;
  });

  it('suppresses transitions for the duration of the swap', () => {
    const frames: Array<() => void> = [];
    const raf = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb) => {
        frames.push(() => cb(0));
        return frames.length;
      });

    document.documentElement.dataset.theme = 'light';
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));

    // Set synchronously, in the same task that changes the theme: a frame
    // later would be a frame too late.
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themeSwitching).toBe('');

    // One frame is not enough — the new values have to be painted before
    // transitions come back, or re-enabling them reintroduces the defect.
    act(() => frames.shift()?.());
    expect(document.documentElement.dataset.themeSwitching).toBe('');

    act(() => frames.shift()?.());
    expect(document.documentElement.dataset.themeSwitching).toBeUndefined();

    raf.mockRestore();
  });

  it('leaves the theme itself set once the suppression is lifted', () => {
    document.documentElement.dataset.theme = 'dark';
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('has a stylesheet rule that acts on the attribute', () => {
    // The attribute alone does nothing. This is the other half, and the two
    // are in different files, which is exactly how one of them gets deleted.
    expect(GLOBAL_CSS).toMatch(/\[data-theme-switching\]/);
    const block = GLOBAL_CSS.slice(
      GLOBAL_CSS.indexOf('[data-theme-switching]'),
    ).slice(0, 400);
    expect(block).toMatch(/transition:\s*none\s*!important/);
    // Descendants, not just the root: every affected element is a descendant.
    expect(block).toMatch(/\[data-theme-switching\]\s*\*/);
  });

  it('is not inside the reduced-motion block, because it is not motion design', () => {
    // A guard that only applies to people who have not asked for less motion
    // would leave the defect in place for everybody else.
    const ruleAt = GLOBAL_CSS.indexOf('[data-theme-switching]');
    const reducedMotionAt = GLOBAL_CSS.indexOf(
      '@media (prefers-reduced-motion',
    );
    expect(ruleAt).toBeGreaterThan(-1);
    expect(reducedMotionAt).toBeGreaterThan(-1);
    expect(ruleAt).toBeLessThan(reducedMotionAt);
  });

  it('still transitions colour somewhere, so the guard is not decoration', () => {
    // If every colour transition were deleted instead, this suite would pass
    // while guarding nothing. The transitions are kept because they exist for
    // hover and focus, where they do their job.
    const transitioning = cssFiles(SRC).filter((path) =>
      /transition:[^;]*\bcolor\b/s.test(readFileSync(path, 'utf8')),
    );
    expect(transitioning.length).toBeGreaterThan(0);
  });
});
