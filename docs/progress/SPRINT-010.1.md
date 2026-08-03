# Sprint 10.1 — Design system, logo and Helpi

Status: **CLOSED (2026-08-03).** Remote CI green on the final HEAD: run
[`30840468940`](https://github.com/AgustinMartinezSM/helpdesk-ai/actions/runs/30840468940)
on `309d498`, green on its first attempt, covering all nine commits — they were
pushed together. The Definition of Ready below was written and checked against
the repository before any visual change.

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

## Outcome

Everything planned landed. The interesting part is what the browser found that
the tests did not, so that is most of what is written down here.

### Phase 1 — the truth baseline

`product-status.ts` was four sprints stale, and fixing it first was right:
every other claim depends on it.

- **Support teams moved to `available`** and lost the sentence — "the screen
  for it is planned" — that had been false since 9.13.
- **Five capabilities were added that had no entry at all**: where a request
  came from (the branch and service point, validated at creation), bulk
  onboarding, organization-defined profile fields, shared-computer sessions,
  tenant isolation and projection recovery. Two of those — tenant isolation
  and the request's place — are the brand's first two proof points and the
  public site had never mentioned either.
- **`PROJECT_STATUS`'s "Implemented" list stopped at Sprint 9.0** and now
  covers the tenancy work, the structure, support teams, invitations, member
  administration, bulk import and reconciliation.
- **"Self-service signup" was not stale, it was wrong.** Registration has
  existed since 9.9. What is actually missing is self-serve _organization_
  onboarding — the first administrator of a new database is still made by
  hand — and the entry says that now.

**The hard-coded statuses were seven, not the six the defect list named.** The
seventh is `hero-visual.tsx`, which rendered the words as a raw string in a
scene hidden from assistive technology, and which a spec pinned — so a fix
working from the list alone would have left it and broken the spec on the way
past. All seven now read from the module.

**ADR 0009 needed two amendments**, and one of them is the lesson: its rule
that "no page hard-codes a status" was written the day the ADR was, and seven
pages did it anyway, because the rule lived in a decision record. It lives in
`claim-truth.spec.tsx` now. **A rule about what code must not do belongs in a
test.** The second amendment settles that `available` means somebody can rely
on the capability without building anything first — not that a screen exists —
which is what projection recovery needed and the vocabulary had never had to
answer.

**Two more truth defects, both on the engineering page.** It said
organizations-service had "no product surface yet", contradicted by three
shipped screens; and its event list named five contracts of which **four had
been deleted** in the tenancy migration's phase 8, so the page was advertising
routing keys nothing publishes and every durable queue unbinds at boot.

**One spec had to be deleted rather than updated**: `trust-pages.spec.tsx`
asserted the engineering page never mentions tenancy, on the premise that
nothing used organizations-service. That premise died in 9.8, and the
assertion then _forbade_ the page from telling the truth. A test enforcing a
stale claim is worse than no test, because it reads as coverage.

### Phase 2 — the token layer

The migration was cheap because the system was already tokenised: redefining
`--accent*` as aliases of the new `--action` family moved 73 call sites at
once, leaving only the ones whose **meaning** changed to be moved by hand.
Those are the ones a find-and-replace would have got wrong: links that now
need an underline, eyebrows that hand their colour to the yellow marker, the
wordmark, and the selected-filter chip that would otherwise have become
indistinguishable from a primary button.

`design-tokens.spec.tsx` re-measures every ratio in `global.css`'s comments on
every run. It caught two defects while being written — a `--border-control`
at 2.994:1 on the tinted band, which is the surface I had not thought to
measure; and a regex of mine that matched `--brand-on` when it meant
`--brand`.

### What the browser found and the tests could not

Three defects, all of them invisible to a passing unit suite. This is the
part of the sprint worth carrying.

1. **One indigo survived the migration.** The final CTA panel rebound
   `--accent` by hand to a second indigo, so a token-level migration could
   not reach it. Counting the elements whose _computed_ colour was indigo
   found it in one query. It is now a `data-surface="inverted"` region that
   inherits a coherent set, which also turned the panel's hand-written focus
   exception — 2.87:1 by its own comment — into the rule: **15.04:1**.

2. **The hero's yellow emphasis was invisible in the dark theme.** A marker
   stroke behind the lower third of the glyphs looked better than a solid
   highlight and measured **1.06:1**, because the heading colour is near-white
   there while the brand is the same yellow in both themes. It is now a solid
   highlight carrying `--brand-on` at 14.83:1, and a test requires any rule
   painting a brand background to set a colour in the same rule.

3. **The section bands had a join I had not counted.** The landing puts a
   `default`-tone section between the sunken one and the next raised one, and
   `default` renders the page background — so the rendered sequence contains
   `sunken↔base`, which my first re-tune put 2.1 L\* apart in light. The test
   had passed because it checked the two pairs I _expected_. It now derives
   the pairs from the tone sequence, which is the difference between testing
   the system and testing my memory of it.

**One join per theme genuinely cannot be separated by lightness** — `base↔raised`
in light, `base↔sunken` in dark — and both are now named exemptions with a
second test asserting they are still that close, so an exemption cannot
outlive its reason.

### Phase 3 — the mark

A dot, a track and an end stop, in ink on the yellow. It is the product's own
smallest unit: every ticket in the interface is already a priority dot
followed by a row. Read left to right it is the promise.

It needs no light and dark variant, which is the practical payoff of the
brand colour being one value in both themes. Verified legible from 16px up in
a real browser. `favicon.ico` — Nx scaffold artwork in an unrelated navy,
competing with the real icon depending on which one a browser resolved — was
deleted rather than restyled.

**The wordmark stopped colouring "AI"**, which had been the visual place of
honour in every header and footer, given to the least available part of the
product.

### Phase 4 — Helpi

Behaviour untouched; language and silhouette changed.

**The silhouette was the sharper problem.** A floating circle in a bottom
corner is the universal sign for "chat with us" — the one thing Helpi is
contractually not — and everything that made it different was invisible until
you opened it. It is now a rounded square with the mark's corner ratio, which
gives the identity a rule worth keeping: **the field says whose it is, the
glyph says which one.**

**Four rules became tests instead of prose.** The compass-not-sparkle rule had
been stated with the same force as the not-a-chatbot rule and only the other
one had a test. The planned-capability guard scanned public routes only,
which left the single hint that mentioned AI permanently unchecked — and it
was the one that overstated. `/organization` had no hint and no prefix guard,
so an administrator configuring branches was offered a tour of the product
they were already inside. And the chatbot blacklist now speaks both
languages: an English-only list would have guarded nothing the moment the
copy became Spanish, while still reading as coverage.

Two things learned in the rewrite, both worth not rediscovering: **an accented
vowel is not a word character in JavaScript regex**, so `/contá\b/` never
matches "Contá el"; and the product's _name_ contains the two letters the
no-AI check looks for, so the check strips the name before matching.

### What this sprint deliberately did not do

- **No page was redesigned.** The token layer propagates; what changed by hand
  is the set of places whose meaning changed.
- **Nothing was translated except Helpi.** es-AR is the primary language and
  full internationalization is Sprint 10.8. Half-translating ahead of the
  machinery that keeps two languages in step is how a half-translated
  interface happens.
- **No component was invented.** There is no Dialog, Banner or Tooltip because
  nothing needs one yet, and inventing them ahead of a use case would be
  inventing their API too.
- **`--accent*` was not deleted**, only aliased. Sprint 10.2 removes it.

### Verification

Full gate green: format, lint, typecheck, 249 unit tests across 27 suites, and
build. Two suites are new — `claim-truth.spec.tsx` and
`design-tokens.spec.tsx` — and 38 of those tests are the design system
checking itself.

In a real browser, on the public surface, both themes: zero contrast failures
across every text node, worst case 4.74:1 in dark and 5.16:1 in light; zero
elements rendering indigo; the rendered band deltas matching the token file;
no horizontal overflow at 375px; and the focus ring resolving to `--focus-ring`
under real keyboard focus.

**The authenticated surface was not opened in a browser.** It needs six dev
servers and the preview tool allows five, which Sprints 9.10 and 9.13 both
hit. Its components inherit the same tokens and are covered by specs, but
nobody has looked at them, and that is recorded as debt rather than implied to
be fine.

### Documentation

- **`docs/architecture/design-system.md`** — new, and the only new file: the
  token reference, the mark and its usage rules, Helpi's visual direction, the
  migration notes and the known visual debt.
- **`frontend-design-system.md`** — its colour half is superseded and says so;
  it keeps the component inventory, the motion catalogue and Helpi's
  behavioural contract, which are still accurate and still its subject.
- **`brand-strategy.md`** — the one section implementation proved needed
  clarifying: the bilingual scope it deliberately left open is now answered by
  the owner's decision, recorded as an answer rather than a question.
- **ADR 0009** — two amendments, above.
- **`CURRENT-HANDOFF.md`** — Sprint 10.1's entry and Sprint 10.2 as the next
  exact action.

No fictional experience, customer, testimonial, incident, external approval or
commercial adoption was introduced. The claim work moved in both directions
and every move is cited to a file in the repository.
