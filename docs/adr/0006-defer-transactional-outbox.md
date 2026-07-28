# ADR 0006 — Defer the transactional outbox (evaluated for sprint 7)

## Status

Accepted (2026-07-28). This is the evaluation ADR 0005 committed to when
audit-service became a consumer.

## Context

ADR 0005 accepted best-effort publishing — a producer commits its database
transaction, then publishes; a broker failure in between loses the event —
"while every projection can be rebuilt", and named audit-service (S7) as
the trigger to revisit. Sprint 7 shipped three consumers, so every lost
event now has a blast radius:

- **audit-service**: a hole in the trail, invisible until someone compares
  it against ticket_history.
- **notification-service**: a lost ticket.created.v1 means ticket_refs has
  no row, and every later event of that ticket dead-letters (visible in
  the DLQ, replayable after re-seeding the ref) — the projection design
  deliberately turns silent loss into visible dead letters.
- **analytics-service**: a lost event skews aggregates until a later event
  for the same ticket self-heals the snapshot.

Trail completeness has TWO failure sides, and an outbox only fixes one:

1. **Publish side** — producer commits, broker unreachable, event never
   exists. Fixed by an outbox.
2. **Consume side** — event delivered, audit's handler fails transiently
   (database blip), message dead-letters with no automatic retry (ADR
   0005). A hole until manual replay. An outbox does nothing here; this
   side needs retry-with-delay tiers on the consumer.

## Decision

**Defer the outbox.** The trigger conditions that make it necessary are
explicit:

- the platform runs in a real environment (today: local-only, no remote,
  no CI run yet), or
- a compliance requirement makes the audit trail authoritative (today the
  authoritative history for tickets is ticket_history inside
  helpdesk_tickets, transactional with every mutation), or
- a consumer appears whose projection CANNOT be rebuilt or self-heal
  (today: notifications are declared non-rebuildable but are ephemeral
  UX, not records; profiles, refs and snapshots rebuild from owner APIs
  or self-heal).

When triggered, the shape is the standard pattern: an `outbox` table
written in the same transaction as the domain mutation, a relay that
publishes and marks rows, and consumer-side dedupe — which sprint 7
already built everywhere (PK = envelope id, unique (user, source event),
LWW snapshots), so producers can adopt an outbox later without touching
any consumer.

## Consequences

- Losses remain possible and bounded: visible as DLQ entries (notification
  path), self-healing skew (analytics), or trail holes (audit) — the last
  one accepted while ticket_history is the authoritative record.
- helpdesk_audit is NOT an event store: no service may rebuild a
  projection by reading it (data-ownership rules are absolute). Rebuild
  paths go through owner APIs, documented per projection in
  data-ownership.md. If replay-from-audit is ever wanted, audit-service
  must grow an API for it — a deliberate future decision, not a shortcut.
- Consumer-side completeness (retry tiers before the DLQ, DLQ depth
  monitoring) is follow-up work independent of the outbox and currently
  manual (management UI).
