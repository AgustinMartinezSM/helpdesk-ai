# ADR 0009 — Public product status representation

- Status: Accepted
- Date: 2026-07-29
- Sprint: 7.6 (Product Experience, Brand and Portfolio)

## Context

The public site presents capabilities that are in very different states:
some work end-to-end in the product UI, some are implemented and routed
behind the gateway but have no product UI yet, and some — at the time of
this ADR, every AI capability — are designed but not built. (Four of the
five AI capabilities have since been built; see the Sprint 9.0 update at
the end.)

A portfolio project is judged as much on candor as on code. Presenting
planned AI features as available would be the fastest way to lose an
interviewer's trust, and it would contradict the product's own claim
that AI output must always be labeled as a suggestion.

At the same time, status text scattered across page copy rots: a
capability ships, the landing page is updated, the features page is
forgotten, and the site starts lying by omission.

## Decision

**A single source of truth** — `apps/web/src/lib/product-status.ts` —
defines every capability, its area and its status. Landing, features and
how-it-works all render from it; no page hard-codes a status.

Four status values, each with an explicit meaning:

| Status           | Label          | Meaning                                                                    |
| ---------------- | -------------- | -------------------------------------------------------------------------- |
| `available`      | Available      | Usable end-to-end in the product UI today                                  |
| `api-ready`      | API ready      | Implemented behind the gateway, but not usable by default — see Sprint 9.0 |
| `in-development` | In development | Being built in the current sprint                                          |
| `planned`        | Planned        | On the roadmap, not started                                                |

Rules that follow from this decision:

- **Every status must be derivable from the repository.** `api-ready`
  claims were verified against the actual controllers (e.g. the tickets
  service exposes `PATCH /:id/assignee` for staff; the audit trail is
  admin-only; analytics summaries are staff-only).
- **`api-ready` carries a `note`** naming exactly what is missing, so
  the label cannot be read as "shipped".
- **Status is never communicated by color alone** — `StatusPill` always
  renders the text label next to the dot.
- **Specs enforce the invariant**: `landing.spec.tsx` and
  `how-it-works.spec.tsx` assert the label each AI capability actually
  carries and that none of them ever reads "Available". The expected
  labels are written out in the specs rather than read from
  `product-status.ts`, so a promotion has to be a deliberate edit in two
  places instead of a status change that its own test agrees with.
- The same file holds `PROJECT_STATUS` (Implemented / In development /
  Planned) rendered on the landing page, kept in sync with
  `docs/progress`.

## Consequences

Positive:

- One edit updates every surface; drift between pages is structurally
  prevented.
- The honest labeling is test-enforced, not merely intended — a
  regression that quietly promotes a planned feature fails CI.
- The four-value vocabulary is more informative than a binary
  shipped/planned split, and it accurately describes a platform whose
  backend runs ahead of its UI.

Negative / accepted:

- `api-ready` is a project-specific term that needs its one-line
  explanation on each page that uses it (provided in the page lead).
- Updating a status requires touching a TypeScript module rather than
  copy — a deliberate trade: statuses are data, not prose.

## Alternatives considered

- **Copy-level status wording per page**: rejected — guarantees drift.
- **Binary available/planned**: rejected — would force API-ready
  capabilities into a wrong bucket in either direction.
- **Deriving status automatically from the codebase**: rejected as
  over-engineering; the mapping requires judgment (a controller existing
  is not the same as a capability being usable).

## Update — Sprint 9.0: what `api-ready` means

Connecting Google Gemini (ADR 0010) broke the original definition of
`api-ready`, which read "Implemented behind the gateway; product UI
pending". The four AI capabilities did not fit any of the four values:

- not `available` — the panel and the API both exist, but nothing answers
  until a deployment supplies its own `GEMINI_API_KEY`, and none of this
  is deployed anywhere;
- not `api-ready` under the old wording — the product UI is not pending,
  Sprint 8 shipped it;
- not `in-development` — the work is finished, not in progress.

I widened `api-ready` rather than inventing a fifth status. The label now
covers one idea with two shapes: **built, reachable, and not turned on.**
Assignment is the first shape — an API with no picker UI yet. The AI
capabilities are the second — an API and a UI that need configuration the
reader's environment does not have.

The vocabulary is still four values. Adding a fifth would have described
this project's exact situation more precisely and made the list harder to
read for everyone; two shapes under one honest label is the better trade.
`in-development` is now unused by any capability, which is fine — it
describes a state the site will be in again.

The rule that made this decision necessary is the one worth keeping:
**every status must be derivable from the repository.** A public status
above `in-development` was not derivable while the Gemini adapter sat
untracked on a branch, so the adapter and the label had to land together.
Code existing has never been enough to earn `available`, and now it is
not enough to earn `api-ready` either — the note has to say what is
missing.
