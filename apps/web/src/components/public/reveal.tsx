'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

export interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger delay in ms, applied via a CSS custom property. */
  delay?: number;
  /**
   * Element to render. Inside an `<ol>`/`<ul>` pass `"li"` so the wrapper
   * does not break list semantics (and `:last-child` selectors).
   */
  as?: 'div' | 'li';
}

/**
 * Progressive section-reveal. Content is fully visible by default
 * (no-JS, SSR, reduced-motion, above-the-fold); only elements that are
 * still below the viewport when JS runs are hidden and then revealed by
 * an IntersectionObserver. This guarantees zero layout shift and no
 * invisible content in any degraded mode.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as: Element = 'div',
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // Stay fully visible when the environment can't animate responsibly.
    if (
      typeof window.matchMedia !== 'function' ||
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    // Elements already on screen never animate — avoids first-paint flicker.
    if (element.getBoundingClientRect().top < window.innerHeight) {
      return;
    }
    element.dataset.reveal = 'pending';
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            element.dataset.reveal = 'visible';
            observer.disconnect();
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -32px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Element
      ref={ref as never}
      className={className}
      style={
        delay > 0
          ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties)
          : undefined
      }
    >
      {children}
    </Element>
  );
}
