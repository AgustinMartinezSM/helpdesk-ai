# Sprint 7.5 — Plan: Visual Redesign of the Web App

Status: PLANNED (authored 2026-07-28, to be executed in a fresh session).
Scope: `apps/web` only (+ its specs). No backend, BFF or gateway changes.
Goal set by the product owner: minimalist, modern, visually comfortable
and attractive; do not skimp on improvements.

## Current state (verified 2026-07-28)

- 6 pages, App Router: `/` (home), `/login`, `/account`, `/tickets`,
  `/tickets/new`, `/tickets/[id]`. All bare semantic HTML with ONE styling
  class (`.page` in `src/app/page.module.css`: max-width 40rem, centered).
  Native browser buttons/inputs. Status/priority rendered as raw text
  (`[open] · high`). No shared UI components, no icons, no dark mode, no
  custom font, no loading/empty states beyond plain text.
- `src/app/global.css`: a Tailwind-style preflight (KEEP, it is a good
  reset) followed by ~430 lines of dead Nx welcome-page boilerplate
  (`#welcome`, `#hero`, `#nx-cloud`, `.button-pill`… — nothing references
  them anymore; DELETE).
- Deps: only `next ~16.2.12`, `react ^19`, `react-dom ^19`. No UI libs.
- Specs (`apps/web/specs/*.spec.tsx`, 4 files): query by role/label/text
  (`getByRole('heading')`, `getByLabelText('Email')`,
  `getByRole('button', { name: 'Sign in' })`). They survive class changes
  as long as semantics stay. ONE literal assert must be updated with the
  redesign: `screen.getByText('[open] · high')` in `tickets.spec.tsx`.
- `layout.tsx` is minimal (AuthProvider only). `AuthProvider` in
  `src/components/auth-context.tsx` exposes `{ status, session, logout }`
  — reuse as-is.

## Design direction

Minimalist, modern, calm. One accent color, generous whitespace, soft
depth, fast subtle motion. Both light and dark themes, both first-class.

### Stack decision (keep engineering minimal too)

- **No new runtime dependencies.** Design tokens as CSS custom properties
  in `global.css` + one CSS Module per component/page. No Tailwind (new
  toolchain for 6 pages is not minimalism), no component library.
- **Font**: Inter variable via `next/font/google` (zero deps, self-hosted
  by Next at build time — works offline after install). Headings with
  tight letter-spacing (-0.02em); `font-variant-numeric: tabular-nums`
  for dates/counters. Monospace stays system (`ui-monospace`).
- **Icons**: small set of inline SVG components in
  `src/components/ui/icons.tsx`, paths copied from Lucide (ISC license —
  note attribution in the file header). No icon dependency.

### Design tokens (`:root` + `[data-theme='dark']`)

- **Palette**: neutral zinc scale for surfaces/text; accent **indigo**
  (`--accent: #4f46e5` light / `#818cf8` dark). Light: bg `#fafafa`,
  surface `#ffffff`, border `color-mix(in srgb, currentColor 12%, transparent)`.
  Dark: bg `#09090b`, surface `#131316` (never pure-black cards).
  Semantic status colors (badges, AA contrast on their backgrounds):
  open → blue, in_progress → amber, resolved → green, closed → zinc.
  Priority dots: low zinc, medium blue, high amber, urgent red.
- **Type scale**: 13/14/16/18/24/32; body 14–16, page titles 24–32/600.
- **Spacing**: 4px base scale. **Radii**: 8 (controls), 12 (cards), 999
  (pills). **Shadows**: two soft layers, e.g.
  `0 1px 2px rgb(0 0 0 / .04), 0 4px 12px rgb(0 0 0 / .06)`.
- **Motion**: 150–200ms ease-out on hover/focus/enter; page content
  fade-up (~8px, 250ms) on mount; skeleton shimmer. Everything inside
  `@media (prefers-reduced-motion: no-preference)`.
- **Focus**: `:focus-visible` ring in accent (2px outline + 2px offset)
  on every interactive element. Never remove outlines without replacing.

### Theming

`prefers-color-scheme` as default + manual toggle (sun/moon in header)
persisting to `localStorage`, applied as `data-theme` on `<html>` via a
tiny inline script in `layout.tsx` BEFORE hydration (no flash). Include
`color-scheme: light dark` so native controls follow.

## Shared components (`src/components/ui/`)

| Component                     | Notes                                                                                                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppShell` (in `layout.tsx`)  | Sticky translucent header (`backdrop-filter: blur`), wordmark "HelpDesk **AI**", nav (Tickets), right side: theme toggle + user menu (email initial avatar, account link, sign out) or "Sign in". Footer minimal. Removes today's ad-hoc `New ticket · Account` link rows. |
| `Button`                      | Variants: primary (accent), secondary (surface+border), ghost, danger; sizes sm/md; `loading` state with inline spinner; hover lift `translateY(-1px)` + active press.                                                                                                     |
| `Input`/`Textarea`/`Field`    | Label above, 1px border, accent border+ring on focus, inline error slot (`role="alert"`), auto-growing textarea for comments.                                                                                                                                              |
| `Card`                        | Surface + border + soft shadow; hover elevation only when clickable.                                                                                                                                                                                                       |
| `StatusBadge` / `PriorityDot` | Pill with dot + label per status; colored dot + label for priority. THE replacement for `[open] · high` (update the literal assert in `tickets.spec.tsx`).                                                                                                                 |
| `Skeleton`                    | Shimmer blocks for list/detail loading (replaces "Loading tickets…").                                                                                                                                                                                                      |
| `EmptyState`                  | Small inline SVG illustration + title + hint + CTA (e.g. "No tickets yet" → "Create your first ticket").                                                                                                                                                                   |
| `icons.tsx`                   | plus, ticket, user, sun, moon, lock, send, arrow-left, chevron-right, check, log-out (Lucide paths).                                                                                                                                                                       |

Keep components presentational (props in, markup out) so existing
data-flow code (`useAuth`, `lib/tickets.ts`) is untouched.

## Per-page scope

- **Home**: minimal hero — wordmark, one-line tagline, primary CTA
  (session-aware: "Go to tickets" / "Sign in"). Subtle decorative
  background (two large blurred accent radial-gradients at very low
  opacity — cheap, no images).
- **Login**: centered card (max-w ~380px), title + fields + full-width
  primary button with loading state; error inline with icon. Link back
  home in header.
- **Tickets list**: page header (title + count + "New ticket" primary
  button with plus icon); filter pills for status (All/open/in_progress/
  resolved/closed) wired to the existing `listTickets` filters; rows as
  clickable cards (title, StatusBadge, PriorityDot, relative "created X
  ago"), hover elevation; Skeleton ×5 while loading; EmptyState.
- **Ticket detail**: back link with arrow icon; header title + badges;
  description in a Card; staff lifecycle actions as a labeled button
  group ("Start progress", "Resolve", "Reopen", "Close" — map from
  NEXT_STATUSES, keep one button per legal transition); requester's
  "Confirm fix and close" as primary. Comments as cards with author-role
  accent border; internal notes visually distinct (amber left border +
  lock icon + "Internal note" label). Comment form with auto-grow
  textarea + send button. History as a vertical timeline (dot + line per
  entry, action label + detail + tabular timestamp).
- **New ticket**: card form; priority as segmented radio-pills
  (low/medium/high/urgent with their dots) instead of a native select;
  primary submit with loading.
- **Account**: profile card with initials avatar, email, roles as pills,
  sign out (danger-ghost).

## Execution constraints (for the implementing session)

- Working rules: Spanish with the user; this sprint was explicitly
  authorized (visual scope, "no escatimar"); any NEW dependency needs
  official-docs version verification first — the plan needs none.
- Order: (1) purge dead CSS + tokens + font + theme script, (2) ui/
  components with specs, (3) AppShell, (4) pages one by one, (5) gate +
  visual pass, (6) SPRINT-007.5.md progress doc.
- Keep every `aria-*`, `role`, label and form semantics — specs depend on
  them. Update ONLY the `[open] · high` literal (and add specs for new
  components: badge renders status, skeleton while loading, filter pills
  call listTickets with the filter).
- Gate: `pnpm format` then `nx run-many -t lint,test,build,typecheck`
  (in PowerShell quote multi-targets: `-t 'lint,test'`). Web fast specs
  live in `apps/web/specs/`.
- Visual verification: `pnpm dev:web` (+ bff/gateway/auth/tickets for a
  real session; `.env` files already exist) or the preview browser;
  check BOTH themes, keyboard-only navigation, and a narrow viewport
  (~380px) — the app must stay comfortable on mobile widths.
- Commits: conventional, `feat(web): …` / `refactor(web): …`, one per
  coherent block (tokens+shell / components / pages / docs).
- Out of scope (stays for S8+): notifications UI, dashboard/analytics UI,
  signup page, assignee picker. Do NOT add features beyond the status
  filter pills (the API already supports them).
