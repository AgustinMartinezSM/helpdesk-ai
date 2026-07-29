# Sprint 7.6 — Product Experience, Brand and Portfolio

Status: complete. Branch: `feature/HD-076-product-experience`.
Date: 2026-07-29.

## Goal

Turn a working authenticated application into a complete, credible
product: a public experience that explains what HelpDesk AI is, who it
serves, how the workflow runs, what is actually built, and who built it
— extending the Sprint 7.5 design system rather than replacing it.

## Sprint 7.5 closure

Sprint 7.5 was committed, gated and verified locally but never pushed
(the repository still has no remote, so CI has never run). It was closed
by fast-forwarding `main` to the sprint branch, and this sprint branched
from `main` — the first integrated base since the repository was
initialized. First push and first real CI run remain open milestones.

## Scope completed

### Phase A — Foundation

- **Route groups** (`refactor`-in-`feat` commit): `src/app/(public)` and
  `src/app/(app)`, each with its own layout and entrance `template`.
  URLs are unchanged. The root layout keeps only fonts, tokens, the
  pre-hydration theme script, `AuthProvider` and site-wide metadata with
  a `%s — HelpDesk AI` title template. The theme toggle was extracted to
  `components/theme-toggle.tsx` and is shared by both shells.
  ([ADR 0007](../adr/0007-separate-public-and-authenticated-web-surfaces.md))
- **Public navigation**: sticky, blurred, session-aware CTAs; mobile
  panel that moves focus in, cycles focus within the header and panel,
  restores focus to the toggle on Escape, locks body scroll, and marks
  the current route with `aria-current`.
- **Public footer**: product, trust and (when configured) external link
  columns, attribution, demo disclaimer — no dead links ever.
- **Public surface tokens**: `--container-public`, `--section-gap`, and
  a `clamp()`-based display scale; skip-to-content link; favicon.

### Phase B — Product storytelling

- **`src/lib/product-status.ts`** — the single source of truth for
  capabilities (five areas) and project status, with four honest states:
  Available, API ready, In development, Planned.
  ([ADR 0009](../adr/0009-public-product-status-representation.md))
- **Landing**: hero with a product scene composed from real UI
  primitives (ticket card, AI panel explicitly stamped _Planned_, audit
  line), value by role, capability grid, workflow preview, security
  preview, architecture diagram, project status, final CTA.
- **`/how-it-works`**: the eleven-step ticket journey with a status pill
  per step, the lifecycle transitions rendered with the product's own
  status badges, the versioned event contracts, and a today-vs-target
  contrast block.
- **`/features`**: every capability grouped by area, each with its
  status and — for API-ready items — a note naming what is missing.

### Phase C — Trust and identity

- **`/security`**: identity and session handling, platform hardening,
  data governance — all mirrored from `SECURITY.md` and the codebase —
  plus an explicit list of what is **not** claimed (no SOC 2/ISO 27001,
  no GDPR/HIPAA program, no pentest, no production hardening) and the
  planned security roadmap.
- **`/about`**: why the project exists, why support operations, why AI
  is treated as an assistant, six working principles, and what the
  project demonstrates. No invented company, clients or metrics.
- **`/engineering`**: architecture diagram, all nine applications and
  four libraries, the stack, six defensible decisions with ADR
  references, how delivery actually works, and an honest note that CI
  has never run on a remote.

### Phase D — Contact and polish

- **`/contact`**: fully validated form (field errors with `aria-invalid`
  - `aria-describedby`, announced summary, duplicate-submission
    protection) whose success state states plainly that the demo has no
    delivery backend, and hands off to a prefilled `mailto:` when a
    contact email is configured.
    ([ADR 0008](../adr/0008-contact-delivery-strategy.md))
- A `Select` primitive was added to the shared field components.
- The inline-link arrow nudge moved inside the reduced-motion guard.

## Dependencies

**None added.** Motion is CSS plus one `IntersectionObserver`
(`Reveal`), which is a no-op without JavaScript, under
`prefers-reduced-motion`, or for content already on screen — so content
is never hidden in a degraded mode and there is no layout shift.

## Specs

49 web tests across 12 suites (was 29 across 7). New suites:

- `public-nav.spec.tsx` — links, `aria-current`, mobile menu open →
  focus moved into the panel → Escape closes and restores focus,
  session-aware CTAs.
- `landing.spec.tsx` — headline and CTAs, **every AI capability card
  carries "Planned"**, project status columns, accessible architecture
  description.
- `features.spec.tsx` — all areas and capabilities render from the
  single source; Available/API ready/Planned labeled correctly with the
  API-ready note.
- `how-it-works.spec.tsx` — implemented steps labeled Available, all AI
  steps labeled Planned, real event contracts, accessible lifecycle
  diagram.
- `trust-pages.spec.tsx` — security page lists what is not claimed;
  about page principles and attribution; engineering decisions, all nine
  applications, honest CI status.
- `contact.spec.tsx` — validation errors announced and linked, honest
  success copy (asserts the absence of "sent" language), duplicate
  protection, reset.

## Verification

- Gate: `pnpm nx run-many -t lint,test,build,typecheck` green across all
  13 projects.
- Browser pass against the running app: correct per-route titles, no
  console or server errors, no dead links (only real routes), heading
  hierarchy `h1 → h2 → h3` with exactly one `h1` per page.
- Responsive: no horizontal overflow at 320, 375, 768, 1024 or 1440 px.
- Mobile menu driven by keyboard: focus enters the panel, twelve
  focusables cycle (desktop nav correctly excluded while hidden), Escape
  closes and returns focus to the toggle, body scroll restored.
- Contact form exercised live: empty submit produced four linked field
  errors plus a summary; a valid submit produced the honest success
  state with no "sent" claim.
- Layout separation confirmed live: `/tickets` renders the application
  shell with no public navigation or footer.
- Reveal audit: all 21 revealed blocks end visible after scrolling; none
  stuck in the pending state.
- Every `api-ready` claim was checked against the code (assignment
  endpoint is staff-only `PATCH /:id/assignee`; audit is admin-only;
  analytics summary is staff-only; notifications expose `GET /me` and
  `PATCH /:id/read`; the gateway routes all three).

The planned adversarial review workflow could not run — all five review
agents failed on a session limit, not on findings. The equivalent checks
were performed manually in the browser and against the code, as listed
above. Re-running it is a candidate first task for the next sprint.

## Documentation

- `README.md` — rewritten: the status table now reflects sprints 1–7.6
  (it still claimed Sprint 2 with services marked Planned that have
  shipped), plus the public-site configuration variables.
- `docs/architecture/frontend-design-system.md` — tokens, components,
  motion catalogue, extension rules.
- `docs/architecture/frontend-public-routes.md` — both surfaces, the
  configuration matrix, and how to add a public route.
- ADRs 0007 (public/authenticated split), 0008 (contact delivery),
  0009 (product status representation).

## Out of scope / deferred

Real email delivery, dynamically generated Open Graph images, sitemap
and canonical URLs (need a real domain), notifications and analytics
product UI, self-service signup, assignee picker, site internationalization.
