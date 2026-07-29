# Sprint 7.6.1 — Content Voice, Product Clarity and Visual Depth

Status: complete. Branch: `feature/HD-076-product-experience` (Sprint 7.6
was still unmerged, so this corrective increment continued on the same
branch). Date: 2026-07-29.

## Goal

Correct three things the finished 7.6 experience got wrong: the About
page described me in the third person, How It Works explained the
architecture before it explained the product, and the public pages were
visually flat. Everything else from 7.6 — route architecture, the
authenticated app, tokens, the status source of truth, accessibility
fixes, tests and honesty mechanisms — was preserved.

## Tooling

`.claude/launch.json` is a developer-machine preview configuration that
had been committed by accident in 7.6. It is now listed in `.gitignore`
and untracked with `git rm --cached`; the local file is untouched and
the rest of `.claude/` remains tracked.

## Correction 1 — About in the first person

The page previously opened with _"HelpDesk AI is a portfolio project by
Agustín Martínez"_, ran a section titled **"The developer"**, and
described the project as its own subject throughout. Only one clause on
the entire page was in the first person.

It is now written as I would write it, and the narrative covers the
ideas the increment asked for:

- **Why I started it** — a request for help travels through a direct
  message, an email thread and a spreadsheet only one team maintains;
  then nobody is sure who is handling it, the same problem is explained
  three times, the context lives in a chat nobody else can read, and
  some requests are simply forgotten.
- **What I wanted to build** — one place where a request stays whole:
  askable without knowing a procedure, visible in status, complete in
  context, traceable in its actions, and assisted by AI without handing
  it the decisions.
- **Why not a simple CRUD** — I wanted the project to be harder than it
  needed to be, so it would force me through permissions, service
  boundaries, duplicate or missing messages, observability, testing and
  decisions that must still make sense six months later.
- **How I think about AI** — an assistant, not an authority. AI reads,
  summarizes and suggests; the technician reviews and stays responsible.
- **What it represents** — a product I am building and a way to grow,
  explicitly _"not a company and I am not pretending it is one"_.

Deliberately **not** invented: any employer, any help-desk job, clients,
funding, offices, testimonials or usage figures. My name now appears
exactly once on the page, as attribution.

## Correction 2 — How It Works for real users

The page opened with an eleven-step technical journey whose first step
mentioned the BFF and an httpOnly cookie, and it never defined what a
ticket is. It now runs in three clearly separated parts:

**Part 1 · Using HelpDesk AI** — defines a ticket in plain words ("a
request for help that keeps its status, its full conversation and its
history in one place"), then a four-step journey (sign in, ask for help,
talk it through, follow the status), real examples of what people
actually ask, and each lifecycle state explained by what it means _for
you_ — closing your own resolved request is your call.

**A complete worked example** — a new `ConversationExample` component
renders one request end to end: a locked invoicing account, the user's
words, the team's question, the user's answer, three status transitions
and a confirmed fix. It exists to show the product is an organized
conversation with an owner, a status, context and an ending — not a list
of records.

**Part 2 · Where AI helps** — a before/after: what the person wrote
versus the summary, category, priority, reason and next step AI would
suggest. The block carries a `Planned` pill, states _"None of this is
built yet"_, and asserts the rule in its own callout: **"AI suggestions
are reviewed by a person. The support team remains responsible for the
final decision."**

**Part 3 · How the platform is built** — a short architecture preview
and a CTA to `/engineering`. The event contracts and the
implemented-versus-target detail moved to `/engineering`, which owns
them under the content responsibility map.

## Correction 3 — Visual depth

**The measurement that drove it.** The 7.6 pages alternated `--bg` and
`--surface`, which are **1.7 L\* apart** — imperceptible. WCAG contrast
ratio is the wrong metric here (it reported 1.04:1 in light and 1.07:1
in dark and would keep reporting ~1.0 whatever we did, because it
compresses near both extremes), so the new levels were tuned in **L\***.

| Level  | Light L\* | Dark L\* |
| ------ | --------- | -------- |
| base   | 98.3      | 2.5      |
| raised | 100       | 8.5      |
| sunken | 93.4      | 1.4      |
| tinted | 96.8      | 8.8      |

Adjacent sections now sit **3.4–7.4 L\*** apart, measured live in the
browser, reinforced by a section hairline. `Section` gained five tones
(`default`, `raised`, `sunken`, `tinted`, `technical`) exposed through
`data-tone` so specs can assert that no two adjacent sections match.

**Brand accent.** Pastel yellow `#ffee8c` entered as a decorative and
surface token only. Measured against the real tokens it is **1.13:1** as
text on the light background and **15.07:1** as a surface with
`--brand-on` text, so the rule is codified in the token comments and the
design-system doc: it never carries text and never carries information
alone. Indigo remains the action and accent-text colour in both themes.

**Applied**: ambient brand field plus a faded grid in the hero; role
cards with a brand rule that appears on hover; brand-filled step
markers; a warm wash on the worked example's header; the request
examples with a brand edge; a contained high-contrast panel for the
final CTA (17.3:1 title, 10.8:1 lead, 7.2:1 note); `technical` grid on
the architecture sections.

**Rejected**: saturated gradient fields, glow behind body copy, neon or
gaming aesthetics, particles, canvas, WebGL, and any new dependency.

## Defect found by measuring

At 320 px the CTA label _"Explore the engineering behind HelpDesk AI"_
with `white-space: nowrap` pushed the document to **389 px** — a real
horizontal overflow. Fixed at the root: buttons are capped at
`max-width: 100%` and wrap below 420 px, and the label was shortened.
This is the class of defect the previous sprint's review caught me
missing, and it only appears if you measure geometry rather than check
that the DOM rendered.

## Honesty protections (unchanged)

`product-status.ts` remains the single source of truth. AI capabilities
remain `Planned` and the specs still fail if they are not. No hosted
demo is claimed — the landing still says the application runs locally
and there is no hosted demo yet. Contact still states it does not send
messages to a server. The engineering page still says remote CI has
never run, because that remains true.

## Verification

- Gate: `pnpm nx run-many -t lint,test,build,typecheck` green across all
  13 projects; `pnpm format:check` clean.
- 87 web tests across 14 suites (was 75 across 13).
- Contrast audited programmatically over every paragraph, heading and
  list item inside a toned section, in both themes, with alpha
  compositing handled: **zero failures**.
- Surface separation measured live in L\* in both themes.
- Overflow measured at 320 px on every public route.
- Heading hierarchy verified: one `h1` per page, no skipped levels.
- Decorative layers verified `aria-hidden` with no text content, and the
  CTA hit-test confirmed the click reaches the button.

## Adversarial review

A four-dimension review (voice and clarity, honesty, visual and
accessibility, responsive and specs) ran over the increment with every
finding independently verified: 32 agents, **14 confirmed findings, all
fixed**.

What it caught that my own pass had not:

- **The worked example contradicted the page above it.** It ended at
  _"Resolved — fix confirmed"_, while the lifecycle list two sections
  earlier defines resolved as _waiting for you to confirm_ and closed as
  _confirmed done_. The example also never showed the requester
  exercising the "final word" the page promises. It now continues:
  resolved → Marina confirms → closed, and a spec forbids the old label.
- **"Administrators: control who can do what"** claimed a
  role-administration capability that exists nowhere — no API, no UI,
  and registration hardcodes `roles: ['user']`. Rewritten, and the note
  below now says roles are assigned outside the product.
- **About claimed the project is built "in the open"** while
  `/engineering` says the repository is local-only and no source link
  renders anywhere. Removed, with a spec guarding against it.
- **Six contrast failures my auditor missed** because it only checked
  text directly inside sections and did not composite gradients: the
  ghost CTA link at 2.33:1 and the focus ring at 2.87:1 on the new dark
  panel, `--text-muted` at 4.09:1 and 4.46:1 on the new sunken and
  tinted surfaces, an author label at 4.23:1, and the brand wash pushing
  the example header to ~3.9:1 in dark. Fixed at the root: the CTA panel
  rebinds its tokens so shared controls resolve against a dark
  background, `--text-muted` moved to `#65656d` (verified ≥4.5:1 on
  _every_ public surface, not just `--bg`), and the brand wash became an
  opaque top rule with no gradient behind text.
- **Four vacuous or missing specs**, including a "defines what a ticket
  is" test that passed on the heading's own words, and heading-structure
  guards deleted for the two rewritten pages.

## A note on measurement

Three apparent defects during verification turned out to be flaws in my
own measurement rather than the code, and each was re-measured before
any conclusion: a 1.16:1 contrast reading came from a parser that did
not understand the `color(srgb …)` format; a failed hit-test came from
probing an element outside the viewport; and eight "footer failures"
came from sampling colours mid-transition, before the 150 ms theme
transition had settled. The auditor now composites alpha down the
ancestor chain, covers links and buttons, and waits for transitions to
finish. Being wrong in both directions is the reason to verify twice.

## Documentation

- `docs/architecture/frontend-design-system.md` — brand token rules with
  the measured ratios, section surface levels in L\*, and a new content
  voice section.
- `docs/progress/SPRINT-007.6.1.md` — this log.

No new ADR: this increment is copy, tokens and CSS. The decisions it
rests on (layout separation, contact strategy, status representation)
are already recorded in ADRs 0007–0009.

## Remote and CI

Still no remote, still no push, still no CI run. That order is
unchanged: complete the increment, pass the gate, review the pages, then
seek explicit approval before configuring a remote.
