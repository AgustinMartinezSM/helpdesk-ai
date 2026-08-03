# Sprint 10.0 — Brand strategy

Status: **CLOSED (2026-08-03).** The Definition of Ready below was written and
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

## Outcome

The deliverable is `docs/architecture/brand-strategy.md`. Below is what the
discovery found, what I decided and why, what I got wrong on the first pass,
and what I deliberately did not settle.

### What the audit actually found

I expected the usual failure — a site claiming more than the product does. The
opposite is true, and it reframed the sprint.

**The public surface understates the product systematically, because it lagged
it.** `apps/web/src/lib/product-status.ts` was last touched in the Sprint 9.12
documentation commit, so it still tells visitors the support-teams screen "is
planned" while an administrator has been using it since 9.13, and CSV import,
organization-defined profile fields, shared-terminal sessions and projection
reconciliation have no entry at all. The landing page's "Implemented" list stops
around 9.0. ADR 0009 commits that list to being kept in sync with
`docs/progress`; it is not.

Only one thing runs the other way, and it is inside the product rather than on
the site: the authenticated shell's footer says "HelpDesk AI — AI-assisted
support" with no status qualifier, three screens away from an AI panel that says
"No language model is connected."

**Ten truth defects are listed with evidence at the end of the strategy
document.** They are 10.1's first task rather than this sprint's, because every
one of them changes a rendered page or a public claim and this sprint wrote no
UI. Three exceptions were pure documentation corrections and were applied here —
see below.

**The honesty machinery itself is the strongest brand asset in the
repository.** Statuses are data in one module, every public page renders from
it, and specs fail CI when a claim outruns the product. That is unusual enough
to build a brand on, and it is why the strategy leads with candor rather than
with a capability.

### The three decisions

**1. Ink acts, yellow marks, chroma states.** The action colour becomes
achromatic — near-black on warm paper, inverted in dark — the pastel yellow
becomes the signature that marks where you are, and blue/amber/green/red stay
reserved for status and priority. Indigo leaves.

_Why I did not simply pick a different hue._ The status palette already spends
blue, amber, green and red on ticket state and priority; the brand spends the
yellow. A chromatic action colour has to squeeze in beside a state, which is how
indigo ended up adjacent to the open-blue `#1d4ed8` in the first place. An
achromatic one collides with nothing and leaves the yellow as the only chroma in
the interface that means "brand" rather than "state". Deep teal was the strongest
alternative and sits next to the resolved-green; a warm ochre is the yellow's own
family and would have muddied it.

_What it costs, said plainly in the document too._ Ink on warm neutrals is
itself a recognisable current look. The differentiation is the yellow's job and
the warm paper under it, so an implementation that takes the ink and skips the
neutral shift will have bought nothing.

**2. Helpi keeps its behaviour and changes its language.** Everything it does is
already the personality this strategy describes — a disclosure rather than a
dialog, never stealing focus, hiding while you type, dismissible and restorable.
Everything it says is English. It becomes rioplatense with voseo, inside the
spec-enforced ~90-character budget that Spanish makes tighter. Its
English-bound spec regexes have to be rewritten in the same commit as the copy,
or the suite passes while asserting nothing.

**3. "From signal to resolution" is adopted, with a Spanish interpretation
rather than a translation.** "De la señal a la resolución" is awkward and
"señal" reads as phone reception first. The Spanish is **"De un aviso suelto a un
problema resuelto"** — an _aviso suelto_ is exactly the thing, a heads-up that
reached somebody and landed nowhere, and the internal rhyme does the work the
English alliteration does.

### What I got wrong before writing it down

Every contrast ratio in the strategy document was computed during this sprint
rather than carried over, and that caught two of my own mistakes: the
light and dark `--border-control` candidates I had chosen by eye measured
**2.35:1** against their surfaces, failing WCAG 1.4.11's 3:1 minimum. They were
replaced with `#8a867c` and `#726e64` — 3.63:1 and 3.85:1 — before anything was
written down. Warming the base neutral also turned out to cost the tinted
section band its separation (1.1 L\*, below the 1.7 the design system had
already found imperceptible), so the bands are re-tuned in the document rather
than left for somebody to discover.

The existing documented figures were re-derived and are correct: indigo at
6.02:1 and 6.67:1, the yellow at 1.13:1 as text on the current background, and
15.07:1 with `--brand-on`. Nothing in the design-system document needed
correcting on that front.

### What this sprint deliberately did not do

- **No page, token, component or claim was changed.** The strategy is a
  direction; 10.1 implements it.
- **`product-status.ts` was not refreshed**, although it is stale and the
  strategy says so at length. It is a spec-pinned module whose edit changes
  rendered public pages — a claims change, which is 10.1's first task under ADR
  0009 and not a documentation correction.
- **The bilingual scope is unanswered.** Whether Spanish is Helpi's voice only,
  the product's second language, or its first is the one decision here with a
  large implementation cost and nothing in the repository to settle it. There is
  no i18n rendered anywhere today — `lang="en"` is hard-coded and every string is
  a literal — but part of the decision was already taken: Sprint 9.6 stored
  organization-defined profile field labels as `label_es_ar` / `label_en_us` so
  that i18n would be "content, not schema churn", and nothing in `apps/web` reads
  the es-AR column yet. 10.1's Definition of Ready must answer the scope question
  and reconcile it with what 9.6 already committed.
- **No Block A work was started or reopened.**

### Validation, and what it caught

The strategy's claims were checked against the repository by an adversarial pass
over four independent lenses — the proof points, the measurements, internal
consistency against this sprint's own rules and the repository writing standard,
and the defect list — each instructed to assume every assertion was wrong until
the repository confirmed it.

**It found fifteen real defects in my own document, and the shape of them is the
point: a strategy whose central pillar is that this project's claims are true was
itself carrying eight overstatements, one arithmetic error and two internal
contradictions.** Each was verified against the code myself before being fixed —
none was taken on the verifier's word — and all fifteen are fixed.

The two that would have done damage:

- **The section-band re-tune reintroduced the exact defect the banding system
  exists to prevent.** I measured every band against `--bg` and it passed. But
  `.technical` renders on `--surface-sunken`, and the landing page orders its
  sections `raised → sunken → raised → technical → tinted` — so sunken and
  tinted are adjacent, and my values put them **0.79 L\* apart**, less than half
  the 1.7 the design system had already found imperceptible. The rule is now
  "measure against the neighbour, not the base", the tone order is recorded as
  part of the system, and the corrected set holds ≥3 L\* on every rendered
  adjacency.
- **I recorded a SECURITY.md correction that I had not actually made.** The
  false sentence lives at line 19 — "the credential therefore guards no mutation
  anywhere in the platform" — and my first pass fixed two _other_ statements
  further down, leaving the file contradicting itself and the sprint record
  asserting a fix the file did not contain. That is worse than not fixing it,
  because a recorded fix stops anyone looking. Line 19 is now corrected.

The rest, briefly. **"Organizations ... created and archived from the product"**
was false — the organization is created by a migration and nothing in the UI
creates, renames or archives one. **"Validated at ticket creation"** wrongly
included departments; a ticket carries a branch and a service point and
deliberately no department (ADR 0022). **"Used for visibility"** was true of
branches only — `canView` has four legs and neither departments nor service
points is one. **"Enforced at every repository port"** does not survive the check
it invites: `commentsFor` and `historyFor` take no organization. That last one I
had copied verbatim from `pilot-readiness.md`, so I corrected it there too rather
than leave the two documents disagreeing. **Three hard-coded AI statuses were
six** — `how-it-works` renders three `StatusPill` literals that will silently
disagree with `product-status.ts` the moment 10.1 refreshes it, and those are the
ones a fix working from my list would have missed. The doc claimed **one i18n
seam where there are two**, **two documentation corrections where it made
three**, and listed `SECURITY.md` among the frozen surfaces after this sprint had
already unfrozen it.

Two were self-contradictions rather than repository errors, and those are the
ones I am least comfortable with. The executive summary said **"every public page
renders from"** the status module — a sentence the same document contradicts six
sections later in its own defect list, and the sentence the whole "candor is
structural" argument rests on. And two audience headings used **"agents"** as an
interface word, which the document's own rejected-vocabulary table bans in the
same breath as it flags that exact drift on the landing page. A brand document
that cannot follow its own vocabulary rule for the length of one file has not
earned the right to impose it.

I am recording this at length rather than quietly fixing it because the failure
mode is worth carrying: every one of these was a claim I believed, several were
inherited from documents in this repository, and the measurement error passed my
own arithmetic because I checked the wrong pairs. **Computing a number is not the
same as checking the constraint the number is supposed to satisfy.**

### Documentation improved

- **`docs/architecture/brand-strategy.md`** — new, and the only new file.
- **`SECURITY.md`** — corrected a false claim, on the second attempt. It said
  `INTERNAL_SERVICE_TOKEN` opens "two read-only membership lookups and nothing
  else" and "guards no mutation anywhere in the platform" — true from 9.11 until
  9.16, false since the on-demand projection reconcile landed. A public trust
  document overstating containment is exactly the failure the site's own security
  page says it exists to avoid, so this could not wait for 10.1. The first pass
  fixed two related statements lower in the file and missed the headline one; the
  adversarial validation caught that, and both are now corrected. The stale
  "opening two read-only lookups and the interim operator mutations" line went
  with it — those operator mutations were deleted in 9.10 and 9.11 — and the
  header's sprint range was corrected from 9.8 to 9.16.
- **`docs/architecture/pilot-readiness.md`** — its "What is genuinely solid"
  section claimed tenant isolation was enforced "at every repository port, and
  ahead of every permission check". Neither half survives the check the document
  invites, and I had copied the sentence into the brand strategy before checking
  it. Both now state the property that is true.
- **`docs/architecture/frontend-design-system.md`** — Helpi's path and framing
  were stale: the file moved out of `components/public/` and is mounted in both
  shells with its own hint set for each, so the document described half the
  surface. The not-AI argument was rewritten to rest on what is actually
  structural (every string is authored by hand) rather than on the public-only
  framing that is no longer true. A pointer to the brand strategy was added,
  saying explicitly that the two documents disagree on purpose until 10.1.
- **`docs/architecture/product-vision.md`** — kept as the Sprint 1 statement it
  is, with a header saying so and pointing capability questions at
  `product-status.ts` and phrasing questions at the brand strategy. Its "Current
  stage" section is labelled as Sprint 1's rather than rewritten; the file's
  value is the original problem statement, and most of that still holds.
- **`docs/handoffs/CURRENT-HANDOFF.md`** — records Block A as closed and Block B
  as open, adds the 10.0 entry, and marks the old "Exact next action" list as
  Block A's rather than the next thing to do.

No generated or robotic wording was found in the files touched; the corrections
above were factual rather than stylistic. **No fictional experience, customer,
testimonial, incident, external approval or commercial adoption was introduced.**
The strategy names its own audiences as descriptions of who the product is for,
never as people who have used it, and it states in three places that nothing is
deployed and there are no users.
