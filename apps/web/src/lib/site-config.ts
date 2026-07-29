/**
 * Public-site configuration. Every external link is configuration-driven:
 * when an env var is absent the corresponding UI simply does not render —
 * the public site must never ship dead links.
 */

function optionalUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    // Validate eagerly so a typo in an env var fails the build, not a user.
    new URL(value);
    return value;
  } catch {
    return null;
  }
}

export const siteConfig = {
  productName: 'HelpDesk AI',
  author: 'Agustín Martínez',
  attribution: 'Designed and developed by Agustín Martínez.',
  siteUrl: optionalUrl(process.env.NEXT_PUBLIC_SITE_URL),
  githubUrl: optionalUrl(process.env.NEXT_PUBLIC_GITHUB_URL),
  linkedinUrl: optionalUrl(process.env.NEXT_PUBLIC_LINKEDIN_URL),
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? null,
} as const;

export interface PublicNavLink {
  href: string;
  label: string;
}

/** Shared by the desktop nav, the mobile menu and the footer. */
export const PUBLIC_NAV_LINKS: PublicNavLink[] = [
  { href: '/', label: 'Product' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/features', label: 'Features' },
  { href: '/security', label: 'Security' },
  { href: '/engineering', label: 'Engineering' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
];
