# Sprint 10.3 — The public site says what the product is

Status: **OPEN (2026-08-03).** The Definition of Ready below was written and
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
