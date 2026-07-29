# Sprint 7.5 — Visual Redesign of the Web App

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-29.
Plan: [SPRINT-007.5-PLAN.md](SPRINT-007.5-PLAN.md) (executed as approved; no
scope changes).

## Goal

Take `apps/web` from bare semantic HTML to a minimalist, modern, visually
comfortable UI — one accent color, both themes first-class, zero new
runtime dependencies.

## Scope completed

- **Foundation** (`refactor(web): purge dead nx css…`): deleted ~420
  lines of dead Nx welcome-page CSS, kept the preflight; added design
  tokens as CSS custom properties (`:root` light / `[data-theme='dark']`)
  — zinc surfaces, indigo accent, semantic status/priority colors, soft
  two-layer shadows, motion tokens; Inter via `next/font/google`
  (self-hosted at build, no runtime dep); pre-hydration theme script in
  `layout.tsx` (localStorage → OS preference, no flash) with
  `color-scheme` so native controls follow.
- **Shared UI** (`feat(web): add shared ui components…`),
  `src/components/ui/`: `icons.tsx` (13 inline Lucide-path glyphs, ISC
  attribution in header, all `aria-hidden`), `Button`/`ButtonLink`
  (primary/secondary/ghost/danger × sm/md, `loading` spinner state),
  `Field`/`Input`/`Textarea` (label-above, focus ring, inline
  `role="alert"` error slot, auto-growing textarea), `Card`
  (`interactive` hover elevation), `StatusBadge`/`PriorityDot` (the
  replacement for the old `[open] · high` text), `Skeleton` (shimmer,
  reduced-motion aware), `EmptyState`. New `specs/ui.spec.tsx`.
- **AppShell** (`feat(web): add app shell…`): sticky translucent
  blurred header — wordmark, Tickets nav, sun/moon theme toggle
  (CSS-driven off `[data-theme]`, so the pre-hydration paint is already
  correct), user menu as native `<details>` (avatar initial, account,
  sign out) with outside-click close; minimal footer; `template.tsx`
  retriggers the fade-up page-enter animation per navigation.
- **Pages** (`feat(web): redesign all pages…`): Home hero with
  session-aware CTA and soft radial glow; Login as centered card;
  Tickets list with count, status filter pills wired to
  `listTickets({ status })`, clickable card rows (badge, priority dot,
  relative "Created X ago"), 5-row skeleton, per-filter empty states;
  Detail with badges header, staff transition buttons labeled by target
  ("Start progress"/"Resolve"/"Reopen"/"Close"), requester
  "Confirm fix and close", comment cards (own = accent border,
  internal = amber border + lock + "Internal note"), auto-grow comment
  form, history as a dot-and-line timeline with humanized actions and
  tabular timestamps; New ticket with segmented priority radio-pills
  (visually hidden radios, `fieldset`/`legend`); Account profile card
  with initials avatar and role pills. Added `src/lib/format.ts`
  (`relativeTime`, `formatDateTime`, defensive against missing dates).
- **Build fixes**: React 19 types the textarea `onInput` as
  `InputEvent` — the handler now derives its type from the attribute;
  Lightning CSS silently dropped `backdrop-filter` when the `-webkit-`
  longhand followed it — only the standard property is kept.

## Specs

21 web tests green (was 8). Semantics preserved (roles/labels
unchanged), so existing queries survived; the one literal assert
(`[open] · high`) became row-scoped `Open`/`High` badge queries.
`index.spec` now wraps the page in `AuthProvider` (the hero CTA is
session-aware). New coverage: badge/priority labels, Button loading,
EmptyState, list skeleton (`role="status"`), filter pills calling the
API with `?status=`.

## Verification

- Gate: `nx run-many -t lint,test,build,typecheck` green across all 13
  projects.
- Live pass against the full stack (web + bff + gateway + auth +
  tickets + users, docker infra): register → login → account → create
  ticket (high priority via radio-pills) → detail → comment
  ("You · now" meta) → list row with badges → `?status=` filter round
  trip → sign out. No console errors; network calls verified.
- Both themes checked (tokens flip, toggle persists to localStorage);
  keyboard focus ring rule served globally; no horizontal overflow at
  380 px.
- A 4-dimension adversarial review workflow (React correctness, a11y,
  CSS/theming, spec quality — 26 agents, every finding independently
  verified against the code) ran over the full sprint diff and
  confirmed 20 findings; all were fixed before closing the sprint:
  - **Behavior**: textarea auto-grow now refits on programmatic value
    changes (clearing after submit) and accounts for border-box
    borders; the tickets count resets when the filter changes; the
    theme script keeps its OS-preference fallback when storage access
    throws; `relativeTime` clamps clock skew (never "in 5 seconds");
    the home CTA shows a skeleton during the silent refresh instead of
    flashing "Sign in" at authenticated users.
  - **Accessibility**: loading buttons switched from `disabled` to
    `aria-disabled` (+ re-entry guards in submit handlers) so keyboard
    focus survives submits; field errors are linked via
    `aria-describedby`/`aria-invalid`; status transitions announce via
    a live region and park focus on the title (the activated button
    unmounts); the theme toggle exposes `aria-pressed`; the user menu
    closes on Escape; inputs got a dedicated `--border-control` token
    (≥3:1 non-text contrast, both themes); dark `--text-muted` raised
    to AA (#8a8a94).
  - **CSS**: the loading spinner falls back to an opacity pulse under
    `prefers-reduced-motion: reduce`; the user-menu dropdown is
    width-capped so long emails ellipsize instead of pushing it
    off-screen at 380 px.
  - **Specs**: the skeleton spec now waits for the authenticated
    header first (it previously matched the auth-restore skeleton and
    passed vacuously); the create-ticket spec selects a priority pill
    and asserts the full POST body; both list empty-state variants are
    covered; new `app-shell.spec.tsx` (nav, theme toggle persistence
    and pressed state, user menu, sign out) and
    `ticket-detail.spec.tsx` (render with badges/comments/history,
    staff transition + announcement, requester confirm-and-close,
    comment post + textarea clear). 29 web tests total.

## Out of scope (unchanged, stays for S8+)

Notifications UI, dashboard/analytics UI, signup page, assignee picker.
