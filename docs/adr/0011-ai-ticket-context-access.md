# ADR 0011 — How ai-service reads ticket content

- Status: Accepted
- Date: 2026-07-29
- Sprint: 8 (AI service)

## Context

`ai-service` needs the text of a ticket — its title, description and
public thread — to produce a summary, a classification, a priority
suggestion or a reply draft. It owns none of that data: `tickets-service`
is the sole writer of `helpdesk_tickets` (ADR 0003).

The event stream does not carry it either. `ticket.created.v1` includes
`title` but no `description`, and `ticket.comment-added.v1` includes
`commentId` and `internal` but no body — the contracts were deliberately
kept to identifiers and facts (ADR 0005). So an event-only consumer
cannot see enough to reason about a ticket.

This is also the platform's first synchronous service-to-service call.
Until now every cross-service flow was an event, and the only HTTP paths
were browser → BFF → gateway → service. Introducing an internal HTTP
dependency deserves an explicit decision and explicit rules, because the
easy version of it — a service-wide credential that can read every
ticket — creates an ambient authority that outlives the feature.

## Decision

Suggestions are generated **on demand**, and `ai-service` fetches the
ticket **synchronously from `tickets-service`, forwarding the caller's own
access token**:

```
staff browser → web-bff → api-gateway → ai-service
                                            │  Authorization: <caller's bearer>
                                            ▼
                                       tickets-service  GET /tickets/:id
```

Rules that follow, all enforced in code:

- **No service credential for the ticket store.** The only token
  `ai-service` sends downstream is the one the caller presented.
  Authorization is therefore inherited: the service can never read a
  ticket the caller could not read. There is no key that grants
  `ai-service` blanket access to the ticket store. It does hold one
  credential of its own — `GEMINI_API_KEY`, added in Sprint 9.0 — but
  that key buys model calls and grants no ticket access whatsoever.
- **Upstream authorization failures pass through unchanged.** A 401 stays
  a 401, and a 403/404 from `tickets-service` becomes `TicketNotFound` →
  404, preserving that service's own decision not to confirm a ticket's
  existence to non-owners.
- **The endpoint is staff-only** (`agent` or `admin`), enforced by
  `ai-service` itself. Requesters cannot spend model budget, and drafts
  written for a technician's review are not exposed to the person who
  opened the ticket.
- **Internal notes are dropped** while building the context, before it
  reaches any provider. `tickets-service` returns them to a staff caller;
  `ai-service` filters them out (ADR 0010).
- **No ticket text is persisted.** A suggestion row stores the model's
  output, the provider, the model id, token usage, latency, the
  requesting user and a SHA-256 `contextHash` of the exact context that
  produced it. The hash gives reproducibility and debuggability without
  copying the source of record into a second database.
- **Bounded call**: 5 s timeout, one attempt. An unreachable
  `tickets-service` produces 503 with a message saying suggestions are
  temporarily unavailable — never a partial suggestion built from
  whatever context happened to arrive.
- **Direct, not through the gateway.** The gateway is the entry point for
  external clients (the BFF); internal calls go service to service, so
  the gateway does not become a hop in every internal path.

Asynchronous pre-generation — a suggestion already waiting when a
technician opens a ticket — is explicitly **deferred**. It requires
either `v2` contracts carrying ticket text or a service credential, and
both are larger decisions than this sprint. The trigger to revisit:
staff ask for suggestions on more than a small fraction of tickets, and
the on-demand latency becomes the complaint.

## Consequences

Positive:

- Authorization has one source of truth (`tickets-service`) and cannot
  drift into a second copy inside `ai-service`.
- No sensitive text is duplicated across databases, so ADR 0003's
  ownership rule holds in spirit and not just in letter.
- The blast radius of a compromised `ai-service` is bounded by whatever
  token a caller happens to present, not by a standing credential.
- Suggestions are generated from the thread as it is at that moment, so
  they cannot be stale by construction.

Negative / accepted:

- `ai-service` availability now depends on `tickets-service` availability
  for the write path. Reading previously generated suggestions does not.
- Latency is the sum of two calls plus the model. Acceptable for an
  explicit, staff-initiated action with a visible loading state.
- The caller's token must have enough remaining lifetime for the whole
  chain. Access tokens are short-lived by design; the failure mode is a
  clean 401 that the BFF already knows how to surface.
- Every suggestion is a deliberate act with a cost. That is intended: a
  budget spent on request is easier to reason about than one spent on
  every inbound event.

## Alternatives considered

- **The client sends the ticket text in the request body**: rejected —
  `ai-service` would store output derived from text it cannot verify, and
  the `ticketId` ↔ content binding would be asserted by the client.
- **A service-to-service credential (client credentials or a shared
  service token)**: rejected for this sprint — it creates standing
  read access to every ticket for a service that only needs one ticket
  at a time, and it must be introduced together with the audit and
  rotation story it deserves.

  Still rejected here, but no longer hypothetical elsewhere: Sprint 9.2
  introduced one for `auth-service` → `organizations-service`, because
  minting a token is the one call with no caller token to forward. The
  rejection above stands for `ai-service`, which always has one. The audit
  and rotation story that sentence asks for is still not built, and
  SECURITY.md says so.

- **`ticket.created.v2` / `ticket.comment-added.v2` carrying text**:
  rejected for now — it copies sensitive content into another database,
  requires dual publishing until every consumer migrates, and buys a
  feature (async pre-generation) this sprint does not ship.
- **Reading `helpdesk_tickets` directly**: rejected outright; it violates
  ADR 0003 and would couple `ai-service` to another service's schema.

## Update — Sprint 9.0: the context now leaves the machine

This ADR was written while the only provider was local, so it settled
what `ai-service` may _read_ and never had to say where that text _goes_.
With `AI_PROVIDER=gemini` it goes to a third party, and that deserves to
be stated plainly rather than left as an inference.

**Sent to Google** when a suggestion is generated: the ticket title, the
description, the public thread with each message's author role, the
current status, priority and category, and a note when the thread was
truncated. Nothing else.

**Never sent:** internal notes. They are dropped in
`build-ticket-context.ts` before a `TicketContext` exists, so no adapter
can include them even by mistake — the provider is handed an object that
never contained them. Sprint 8 verified this as behavior rather than
intent: adding an internal note left the stored `contextHash`
byte-identical, while adding a public reply changed it.

**Not stored, either way.** A suggestion keeps the model's output plus a
SHA-256 hash of the context. No ticket text is persisted by this service,
and the `ai.suggestion.created.v1` event carries identifiers and metadata
only.

The rules above are unchanged by this — token forwarding, staff-only
access, one attempt, the timeout. What changes is who can see the text
that passes them, and that is a deployment's decision to make knowingly:
with `AI_PROVIDER=local` nothing leaves the process at all.
