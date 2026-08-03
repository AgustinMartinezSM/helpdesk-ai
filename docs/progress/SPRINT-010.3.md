# Sprint 10.3 — The public site says what the product is

Status: **CLOSED (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any copy changed.

## Definition of Ready

**Previous dependency complete.** Sprint 10.2 is merged and closed with remote
CI green: run `30846715801` on `bc593e6`, plus its closing record on
`d5505c2`. `main` equals `origin/main` at `d5505c2`, working tree clean. The
last sprint document is `SPRINT-010.2.md`.

**And this one gets a Definition of Ready before the work, unlike the last
one.** 10.2's scope was a list somebody had already written; this one has to
decide what the site says about the product's shape, which is exactly the
kind of thing that should be settled before it is typed.

### What the repository says, checked first

**The gap the brand strategy predicted is real, and it is bigger than
"understated".** Grepping the public pages for the product's own vocabulary:

| Term            | Appearances in public page prose                         |
| --------------- | -------------------------------------------------------- |
| `department`    | **none**                                                 |
| `service point` | **none**                                                 |
| `branch`        | the hero lead, and a technical listing on `/engineering` |
| `support team`  | four, all incidental — never explained                   |

So the product's actual shape — an organization with branches, departments
where requesters work, support teams that resolve, and service points inside
a branch — has **no public explanation at all**. A visitor cannot learn from
this site that the thing is multi-tenant, let alone that a department and a
support team are different concepts. That distinction is differentiation item
2 in the strategy, and it is the mistake ADR 0022's first draft made before
the project owner caught it.

**The vocabulary rules are already clean.** A sweep for every term in the
strategy's Rejected list — category inflation, empty verbs, AI overstatement,
words for things that do not exist, words that break the model — returns
nothing across `apps/web/src`. So this sprint adds rather than repairs, which
is a different and easier job than 10.1's was.

**The tagline architecture is applied** as of 10.1: descriptor in the
metadata and the footers, promise in the hero, status line wherever claims
are made. The brand line is deliberately absent from the landing and stays
that way.

**`/how-it-works` is the page written for somebody who has never used a help
desk** — the design system records that as its voice, and the page defines a
ticket in plain language before using the word. That makes it the right home
for the structural vocabulary, and the wrong place for the words to appear
without being taught.

## What this sprint is, and is not

**In scope:** teaching the product's structure on the public site, in plain
language, in the page whose voice is already pitched at somebody new; naming
the department-versus-support-team distinction publicly for the first time;
raising the multi-tenant story to the landing at the level of a
differentiator rather than a feature bullet; and a test that keeps the
vocabulary honest.

**Out of scope:** a new route, a new page, an information-architecture
change, any visual change beyond what existing components already do, i18n
(10.8), and everything Block A deferred. No capability claim moves without
`product-status.ts` moving first, and nothing in this sprint needs one to.

## Definition of Done

- A visitor can learn from the public site that the product is multi-tenant
  and what its four structural concepts are.
- A department and a support team are explained as different things, in the
  words the product itself uses, and a test refuses copy that conflates them.
- Every term used matches the strategy's approved vocabulary, and no term
  from the rejected list appears.
- No capability is claimed beyond what `product-status.ts` says.
- The full gate passes, commits are focused Conventional Commits, merge to
  `main` is `--ff-only`, remote CI green on the final HEAD, working tree
  clean, and `CURRENT-HANDOFF.md` names the next exact action.

## Outcome

### What the site now teaches

A new section on `/how-it-works` — the page whose voice is already pitched at
somebody who has never used a help desk — defines the five structural terms as
a definition list, in the order somebody meets them rather than the order the
schema declares them, and using the product's own words rather than the
model's: **service point**, not "operational station", because ADR 0016 is
explicit that the two may differ.

Three sentences carry the weight:

- **"A department is not a support team. A department says where somebody
  works; a support team says what they fix."** This is the distinction ADR
  0022's first draft got wrong, and it had never appeared publicly. It is now
  the same sentence the Organization screen shows inside the product, so the
  site and the app agree word for word.
- **"None of this is compulsory."** The small-business objection the strategy
  named — a company at one address can create one support team and never touch
  branches or departments. Without this the section reads as a reason not to
  start.
- **Tenant separation is enforced in the database**, with a link to the
  security page rather than a claim repeated in two places.

On the landing, a new section states what the structure BUYS rather than what
it is — three cards, and a link into the page that teaches the vocabulary.
Raising it there was the point: this is the brand's first differentiator and
it had been living as a feature bullet.

### Two stragglers from 10.1, found by reading the rendered page

Both in the footer, which 10.1's tagline work did not reach:

- **The fourth competing tagline was still there** — "Support operations,
  improved by artificial intelligence — with human control over every
  important decision." It is now the descriptor and the promise, per the
  architecture.
- **"Demo environment — no production data."** claimed a deployment that does
  not exist. Two pages earlier the hero says nothing is hosted. It now says
  the same thing.

### The band the new section broke, and the test that caught it

The landing section was first written as `tinted`, which put it **2.1 L***
from the page background it sits next to. The band test caught it — but only
because the same commit changed the test to **derive the tone sequence from
the page source** instead of listing it.

That change matters more than the section. Sprint 10.1 hard-coded the
sequence it believed the landing had and passed while the rendered page
carried a join it had not counted; this sprint then added a section, which
would have made the hard-coded list stale a second time within two sprints.
It now reads `<Section>` tones out of the page files, treats a missing
`tone` prop as `default` — the exact thing 10.1 forgot — and checks
`/how-it-works` and `/features` as well as the landing.

The section is `sunken`: 5.3 L* from the page background in light, 7.4 from
the raised section that follows.

### One contrast defect, and a duplicate declaration of my own making

The hero's decorative AI panel draws its own wash over the ticket card, which
lifts the surface just enough to put `--text-muted` at **4.00:1** on it. The
scene is `aria-hidden`, and that was the reason it had never been questioned
— but `aria-hidden` hides something from assistive technology, not from the
people looking at it. Those labels are `--text-secondary` now.

Fixing it took two attempts, and the first one is worth recording: my edit
inserted `color: var(--text-secondary)` **above** a `color: var(--text-muted)`
that was already in the same rule, so the old one still won. The browser said
the computed colour was still muted; reading the file said the fix was
applied. **The measurement was right and the reading was wrong.**

### Verification

Full gate green: format, lint, typecheck across 15 projects, **266 unit tests
across 28 suites**, build.

In a real browser, both themes, on the landing and `/how-it-works`: **zero
contrast failures** across every text node — worst case 5.19:1 in dark and
5.30:1 in light — every rendered band separation at or above 3.2 L* in light,
and no horizontal overflow.

The authenticated surface was again not opened in a browser: six dev servers
against five preview slots, unchanged since 9.10. Nothing this sprint changed
lives there.

### Documentation

- `docs/handoffs/CURRENT-HANDOFF.md` — Sprint 10.3's entry and the next exact
  action.

No fictional experience, customer, testimonial, incident, external approval or
commercial adoption was introduced. Every term used on the new surfaces comes
from the brand strategy's approved vocabulary, and a test now refuses the
rejected list rather than trusting a sweep.
