# ADR 0009 — Public product status representation

- Status: Accepted
- Date: 2026-07-29
- Sprint: 7.6 (Product Experience, Brand and Portfolio)

## Context

The public site presents capabilities that are in very different states:
some work end-to-end in the product UI, some are implemented and routed
behind the gateway but have no product UI yet, and some — notably every
AI capability — are designed but not built.

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

| Status           | Label          | Meaning                                            |
| ---------------- | -------------- | -------------------------------------------------- |
| `available`      | Available      | Usable end-to-end in the product UI today          |
| `api-ready`      | API ready      | Implemented behind the gateway; product UI pending |
| `in-development` | In development | Being built in the current sprint                  |
| `planned`        | Planned        | On the roadmap, not started                        |

Rules that follow from this decision:

- **Every status must be derivable from the repository.** `api-ready`
  claims were verified against the actual controllers (e.g. the tickets
  service exposes `PATCH /:id/assignee` for staff; the audit trail is
  admin-only; analytics summaries are staff-only).
- **`api-ready` carries a `note`** naming exactly what is missing, so
  the label cannot be read as "shipped".
- **Status is never communicated by color alone** — `StatusPill` always
  renders the text label next to the dot.
- **Specs enforce the invariant**: `landing.spec.tsx` asserts that every
  AI capability card carries "Planned", and `how-it-works.spec.tsx`
  asserts the AI steps are labeled `Planned` rather than described as
  working behavior.
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
