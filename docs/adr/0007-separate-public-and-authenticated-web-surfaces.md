# ADR 0007 — Separate public and authenticated web surfaces

- Status: Accepted
- Date: 2026-07-29
- Sprint: 7.6 (Product Experience, Brand and Portfolio)

## Context

Until Sprint 7.5 `apps/web` served a single surface: every route rendered
inside one application shell (`AppShell`) with a product navigation
("Tickets"), a user menu and a single global `metadata` block. The
landing page was a placeholder.

Sprint 7.6 adds a full public product experience — landing,
how-it-works, features, security, about, engineering and contact — that
has fundamentally different requirements from the authenticated
application:

- **Chrome**: marketing navigation with a mobile menu and a rich footer
  versus an application header with a user menu.
- **Rendering**: public content is static and should be server-rendered
  for first paint and crawlability; the product UI is session-driven and
  inherently client-side.
- **Metadata**: every public route needs its own title, description and
  Open Graph data; authenticated routes do not.
- **Audience**: an anonymous visitor evaluating the product versus a
  signed-in user doing work.

Serving both from one shell would mean conditional chrome inside a
single layout, client components everywhere (because `metadata` cannot
be exported from a client component), and a navigation that changes
meaning depending on session state.

## Decision

Split the App Router tree into two **route groups**:

```
src/app/(public)/   landing, how-it-works, features, security,
                    about, engineering, contact, login
src/app/(app)/      tickets, tickets/new, tickets/[id], account
```

- `(public)/layout.tsx` renders `PublicNav` + `PublicFooter` and a
  skip-to-content link. Its pages are **Server Components**;
  interactivity lives in small client islands (`PublicNav`,
  `ThemeToggle`, `ContactForm`, `Reveal`).
- `(app)/layout.tsx` renders the existing `AppShell` unchanged.
- The root layout keeps only what both surfaces share: fonts, design
  tokens, the pre-hydration theme script, `AuthProvider` and site-wide
  metadata defaults (including the `%s — HelpDesk AI` title template).
- `template.tsx` (the per-navigation entrance animation) moves **into**
  each group, so a shell no longer remounts on route changes.
- `login` lives in `(public)`: it is the entry point of the public
  funnel and must be reachable with the marketing navigation present.

Route groups do not appear in URLs, so **every existing URL is
unchanged**.

## Consequences

Positive:

- Public pages ship as Server Components — less client JavaScript, no
  session round trip before first paint, and per-route `metadata`.
- Each surface evolves independently; the authenticated shell was not
  modified beyond extracting the shared theme toggle.
- The chrome a visitor sees never depends on a conditional inside a
  shared layout.

Negative / accepted:

- Two layouts to keep visually coherent. Mitigated by both consuming the
  same design tokens and the same `components/ui` primitives.
- Spec imports had to be updated to the new paths (mechanical, done in
  the same commit as the move).
- The shared theme toggle had to be extracted from `AppShell` into
  `components/theme-toggle.tsx`.

## Alternatives considered

- **One shell with conditional chrome**: rejected — forces the whole
  tree to be client-rendered and couples marketing chrome to session
  state.
- **A separate Next.js application for the public site**: rejected —
  duplicates the design system, the build pipeline and the deployment
  for a site that shares tokens, primitives and the login entry point.
