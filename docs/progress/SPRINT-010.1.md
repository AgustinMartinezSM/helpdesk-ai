# Sprint 10.1 — Design system, logo and Helpi

Status: **OPEN (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any visual change.

## Definition of Ready

**Previous dependency complete.** Sprint 10.0 is merged and closed with remote
CI green: run `30835775468` on `19f1f8a`, plus `30835400484` on `ba786c3` and
`30834970537` on `a46f545`. `main` equals `origin/main` at `19f1f8a`, working
tree clean. The last sprint document is `SPRINT-010.0.md`.

**The strategy is approved and this sprint implements it.**
`docs/architecture/brand-strategy.md` is authoritative for how things are said
and how the identity works; `apps/web/src/lib/product-status.ts` stays
authoritative for what may be claimed (ADR 0009). That split does not change
here — but this sprint is the first time the second half gets edited, and the
order matters: **claim truth first, identity second.**

**Two owner decisions arrived with this sprint and refine the strategy.**

1. **The visual direction is confirmed for implementation**: ink acts, yellow
   marks, chroma states. Primary actions use achromatic ink or warm light
   values; `#FFEE8C` is the signature and may carry identity, emphasis,
   guidance and selected moments, but never body text and never a combination
   where the measurement fails; semantic blue, green, amber and red stay
   reserved for product states; indigo stops being the action colour; teal is
   explicitly **not** its replacement; action colour and status colour must not
   compete.

   The one thing this widens versus the strategy document: 10.0 wrote the
   yellow's job as "marks where you are and what is ours". Emphasis and
   selected moments are now in scope. The measured constraint is unchanged and
   is what bounds it — 1.12:1 as text on the warm page is why the rule exists.

2. **es-AR is the primary product and brand language.** This answers the one
   question 10.0 deliberately left open, and it answers it in a specific,
   bounded way: Helpi speaks natural es-AR voseo now, en-US remains a planned
   supported language, **complete internationalization is Sprint 10.8**, and
   `label_es_ar` / `label_en_us` in users-service stays exactly as it is. So
   this sprint makes the system **structurally localization-safe** and does not
   translate the product. The strategy document's "Spanish and English" section
   is updated to record the decision rather than keep presenting it as open.

**What the repository says, checked before planning anything:**

- **The migration is cheap because the system is already tokenised.** 73 uses
  of the indigo accent tokens across 28 files, and the design system's own first
  principle is that a component hard-coding a colour is a bug. Redefining the
  token migrates most of the product; the work is deciding which of those 73
  uses were asking for "the action colour" and which were asking for something
  the system never gave a name to.
- **`product-status.ts` was last touched in the Sprint 9.12 documentation
  commit**, which is what makes the site understate the product. It is the
  first file this sprint edits.
- **`how-it-works/page.tsx` imports `StatusPill` and imports nothing from
  `product-status.ts`**, so three of the six hard-coded statuses live there.
  ADR 0009's own sentence naming that page among the ones rendering from the
  module is therefore stale and is amended in the same commit.
- **Six dev servers are needed for an authenticated screen and the preview tool
  allows five.** Sprints 9.10 and 9.13 both hit this. This sprint does not fight
  it: the public surface is verified in a real browser, and the token layer is
  verified in a real browser through a standalone harness that loads the real
  `global.css`, so the measurements are real rather than asserted.

## What this sprint is, and is not

It converts an approved strategy into a coherent visual foundation. It does not
rebuild pages.

**In scope:** the claim-truth baseline; the token layer with semantic naming;
the logo and identity foundation; Helpi's visual direction and es-AR voice; the
reusable component set; a representative surface that proves the system; tests;
and the smallest authoritative documentation set.

**Out of scope, and not started:** public-site information architecture, a
landing rebuild, a full authenticated redesign, onboarding or role-specific
experiences, complete i18n (10.8), WhatsApp, email, billing, SSO, SCIM,
automatic routing, and every production-readiness item. Block A stays closed.

## Plan

1. **Truth baseline.** Refresh `product-status.ts` against the repository, add
   the capabilities it never gained entries for, remove the six hard-coded
   statuses so the pages render from the module, correct the app footer, the
   engineering page and the role label, and amend ADR 0009. Specs that pin the
   changed text change in the same commit.
2. **Token layer.** Warm neutral ramp, achromatic action colour, semantic
   families with no overlap, re-tuned section bands measured against the
   neighbour rather than the base, focus-ring inversion, and documented
   compatibility aliases where a one-step removal would be unsafe.
3. **Identity.** Wordmark, symbol, lockups, application icon, monochrome and
   clear-space rules. Repository-native editable SVG, no opaque binaries.
4. **Helpi.** Visual direction, es-AR voseo copy including the chrome strings,
   the `/organization` fallthrough fixed, and the spec guard extended to the
   routes it never covered.
5. **Components and a representative surface.**
6. **Tests, then documentation.**

## Definition of Done

- Every public claim matches a repository-confirmed capability, and nothing
  claims production availability, email delivery, automatic routing, queues,
  billing or WhatsApp.
- Action colours and status colours are separable, and a test says so rather
  than a person.
- Yellow appears in no text combination that fails its measurement.
- Adjacent section surfaces meet their intended distinction **as rendered**,
  not against the page background.
- Both themes preserve hierarchy; focus is visible on every surface a control
  can sit on, including the contained dark panel.
- Helpi keeps every spec-guarded behaviour, uses no sparkle or chat
  representation, and speaks natural es-AR voseo.
- Departments and support teams stay linguistically distinct.
- Components stay safe for longer en-US or es-AR strings.
- The full gate passes, commits are focused Conventional Commits, merge to
  `main` is `--ff-only`, remote CI is green on the final HEAD, the working tree
  is clean, and `CURRENT-HANDOFF.md` names Sprint 10.2 as the next exact action.
