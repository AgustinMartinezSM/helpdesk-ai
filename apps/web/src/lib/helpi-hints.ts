/**
 * Helpi's hints — the single source of truth for what the guide says.
 *
 * Helpi is a written guide, not a chatbot and not AI. Every string here is
 * authored by hand and selected by route; nothing is generated. That is a
 * hard constraint, not a style choice: the whole public site states that
 * AI assistance is `Planned`, so a companion that behaved (or read) like
 * an AI assistant would contradict the product's own honesty claims.
 *
 * Rules for adding a hint:
 * - One or two short sentences, second person, under ~90 characters.
 * - Never promise a capability `product-status.ts` marks as planned.
 * - Never invite conversation ("ask me", "chat with me") — Helpi cannot.
 */

export interface HelpiHint {
  /** One or two short sentences shown in the panel. */
  message: string;
  /** Optional in-product link, when there is an obvious next step. */
  action?: { href: string; label: string };
}

export const HELPI_INTRO = "I'm Helpi. I can show you how HelpDesk AI works.";

/** Shown under every hint so Helpi never gets mistaken for a chatbot. */
export const HELPI_DISCLAIMER = 'Short written hints — not a chatbot.';

const HINTS: Record<string, HelpiHint> = {
  '/': {
    message: HELPI_INTRO,
    action: { href: '/how-it-works', label: 'Start here to understand it' },
  },
  '/how-it-works': {
    message: 'A ticket is simply a request for help that stays organized.',
  },
  '/features': {
    message: 'Every capability here is labeled with what works today.',
    action: { href: '/how-it-works', label: 'See it in practice' },
  },
  '/security': {
    message: 'These are real engineering decisions, not certifications.',
  },
  '/engineering': {
    message: 'Here you can explore how the system is built.',
  },
  '/about': {
    message: 'Why I built this, in my own words.',
  },
  '/contact': {
    message: 'This form prepares a message — it does not send one.',
  },
  '/login': {
    message: 'You can sign in here to access the platform.',
  },
};

/**
 * The hint for a route, or null when Helpi has nothing useful to add.
 * Unknown routes fall back to the intro rather than showing nothing, so a
 * new page never leaves the guide silently broken.
 */
export function hintFor(pathname: string): HelpiHint | null {
  const exact = HINTS[pathname];
  if (exact) {
    return exact;
  }
  // Authenticated routes are out of scope: Helpi is public-only for now.
  if (pathname.startsWith('/tickets') || pathname.startsWith('/account')) {
    return null;
  }
  return HINTS['/'];
}
