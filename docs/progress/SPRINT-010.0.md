# Sprint 10.0 — Brand strategy

Status: **OPEN (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any strategy work.

## Definition of Ready

**Previous dependency complete.** Sprint 9.16 is merged and closed with remote
CI green: run `30798798526` on `612bea2` (first attempt), plus `30799187949`
on `8b28263` and `30799586050` on `b11b15b` for the closing records. `main`
equals `origin/main` at `b11b15b`, working tree clean. The last sprint document
is `SPRINT-009.16.md`.

**Block A is formally complete and stays closed.** Nothing in this sprint
reopens it. Its deferred work — email delivery, seeded role-template rows, the
four projections without reconciliation, scheduled integrity checks, load
testing, backups, the second security review, and the rest — stays where it is
recorded: `docs/architecture/pilot-readiness.md` and the handoff's "Work
incomplete / deliberately deferred" list. This sprint changes none of it and
starts none of it.

**This opens Block B, and Block B has no plan file in the repository.** The
sprint records that mention it (9.5, 9.6, 9.8, 9.9) call it "the unnumbered
Block B" — the block that owns the product surface — and
`docs/roadmap/PRODUCT-ROADMAP.md` was never created (recorded in 9.0, confirmed
still absent in 9.15). The brief for this sprint is the plan; this document and
the handoff are where the repository records that Block B is now open and what
its first sprint is.

## What this sprint is, and is not

A strategy and product-definition sprint. The deliverable is a decision
document: a brand strategy grounded in what the product actually does after
Block A, precise enough that Sprint 10.1 can implement a design system from it
without reopening the questions it settles.

Not in scope: redesigning pages, writing UI code, email, WhatsApp, billing,
SSO, SCIM, any production-readiness item, or the later product-knowledge
assistant for Helpi. If the strategy work surfaces a defect in existing copy or
documentation, the fix is recorded here and applied only where it is a
documentation correction rather than a redesign.

## What the repository already says, checked before proposing anything

The audit starts from facts, and five of them shape the whole sprint:

1. **`docs/architecture/product-vision.md` is frozen at Sprint 1.** It still
   says "None are implemented as of Sprint 1" about capabilities the product
   has shipped and verified. The live source of truth for public claims is
   `apps/web/src/lib/product-status.ts` (ADR 0009), enforced by specs. The
   strategy document must be grounded in the latter, and the vision document
   needs at least a pointer so the next reader is not misled.

2. **Helpi already exists, with hard constraints guarded by specs.** It is
   written guidance, not a chatbot and not AI: no text input, hand-authored
   hints in `lib/helpi-hints.ts`, the line "Short written hints — not a
   chatbot.", `CompassIcon` and never `SparklesIcon` or a speech bubble, and
   specs that reject "ask me", "chat with" and any capability
   `product-status.ts` marks planned. The brief's definition of Helpi as a
   deterministic guide matches what is built. The strategy extends these
   constraints; it does not renegotiate them.

3. **The pastel yellow already has a measured rule.** `#FFEE8C` is
   `--brand` in `global.css`, and the design system documents why it never
   carries text and never carries information alone: 1.13:1 against the light
   background, 15.07:1 with `--brand-on` when used as a surface. Any
   "signature accent" direction this sprint defines inherits that measurement;
   a strategy that asks yellow to do what it measurably cannot is wrong before
   it starts.

4. **The action colour today is indigo (`#4f46e5` light / `#818cf8` dark)** —
   exactly the generic indigo/violet SaaS appearance the brief asks the
   identity to become distinct from. The material question of this sprint is
   therefore the role of indigo: what replaces or demotes it, where the yellow
   can and cannot take over, and what the neutrals do meanwhile. The brief
   gives the direction (distinct, yellow as signature); 10.0 decides the how
   and writes the rules 10.1 implements.

5. **The voice rules already exist and are enforced.** The repository's
   writing standard (handoff), the first-person `/about` voice pinned by
   `trust-pages.spec.tsx`, product voice bound by `product-status.ts`, and the
   standing rule against fabricated customers, testimonials or adoption. The
   brand strategy adds vocabulary and tone rules on top; it cannot contradict
   the enforcement that exists.

One more boundary worth restating because brand language is where it would
blur: **a support team is not a department** (ADR 0022). Any audience
definition, example copy or vocabulary list this sprint produces keeps the two
concepts distinct, in both languages.

## Product objective

A distinct, defensible and usable brand strategy for HelpDesk AI, based on the
product that exists after Block A, that later work can implement: visual
identity, logo, design system, public website, authenticated experience,
onboarding, Helpi, motion and illustration, and Spanish and English product
language.

## Plan

1. **Discovery.** Audit the existing product surfaces before proposing
   anything: public routes and their copy, the authenticated shell, tokens and
   both themes, logo and iconography, Helpi as built, the capability truth in
   `product-status.ts` against the sprint records. Classify what to retain,
   evolve, what is generic, what misrepresents, what is inconsistent between
   the two surfaces, and what cannot be claimed yet.
2. **Strategy.** One authoritative document —
   `docs/architecture/brand-strategy.md`, beside the design-system reference
   it will guide — covering audiences, positioning, personality, tone,
   vocabulary, visual direction, Helpi principles, tagline architecture,
   bilingual messaging principles, example copy, claims allowed now versus
   deferred, and implications for 10.1 and later.
3. **Documentation.** Update `CURRENT-HANDOFF.md`, point
   `product-vision.md` at the live status source, and record Block B as open.
   No new redundant files beyond the strategy document itself.

## Definition of Done

- Every proof point in the strategy document is verified against implemented,
  repository-recorded capability — nothing claimed because its code merely
  exists.
- No unsupported availability claim introduced anywhere.
- Spanish and English examples are consistent with each other and with the
  es-AR voseo direction for Helpi.
- The visual direction states its accessibility consequences and respects the
  measured contrast rules.
- Departments and support teams stay distinct in every example and vocabulary
  list.
- AI is described as assistance a person reviews, never autonomous
  decision-making.
- The direction is distinct from the current indigo/violet default, with the
  reasoning written down.
- `pnpm format:check` and the repository's documentation checks pass; commits
  are focused Conventional Commits; merge to `main` with `--ff-only`; remote
  CI green on the final HEAD; working tree clean; `CURRENT-HANDOFF.md` names
  Sprint 10.1 as the next exact action.
