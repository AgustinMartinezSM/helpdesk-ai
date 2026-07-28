# Sprint 7 — Consumers of Record

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-28.

## Goal

Give the sprint-6 event stream its consumers: an immutable audit trail,
in-app notifications, and dashboard projections — each a separate service
owning its own database, fed only by events.

## Scope completed

- **Design review before code**: a four-lens panel (event semantics,
  security, architecture, operability) reviewed the written design; its
  findings hardened it before implementation — audit became admin-only
  (payloads carry registration emails), `ticket_refs` dropped its unused
  `assignee_id` (stale-data risk with no reader), notification/analytics
  consumers got `prefetch: 1` (serialized handling closes the
  created-vs-follow-up race), a missing ref now dead-letters instead of
  ack-dropping (visible and replayable, never silently lost), the
  analytics LWW guard moved into atomic SQL, and `subscribeAll` was
  renamed `subscribeFirehose` with docs restricting it to schema-on-read
  consumers.
- **libs/messaging**: `subscribeFirehose` — arbitrary topic patterns,
  envelope-only validation, opaque payloads; same durable queue + DLQ
  topology. Domain consumers keep `subscribe()` with contracts.
- **libs/security**: `Actor`/`isStaff`/`isAdmin` extracted before the new
  services became the third, fourth and fifth copies (tickets/users keep
  their domain-local copies; migration noted).
- **audit-service (:3006)**, `helpdesk_audit`: firehose (`#`) into
  `audit_events` with PK = envelope id (`ON CONFLICT DO NOTHING` — the
  trail is idempotent and append-only; no update/delete anywhere).
  `GET /audit` is admin-only, limit bounded to 100, `type` validated
  against the versioned-name pattern.
- **notification-service (:3007)**, `helpdesk_notifications` (new DB in
  the plan): local `ticket_refs` projection resolves recipients; policy —
  status changes and public staff comments notify the requester,
  assignment notifies the assignee, never the actor themselves, internal
  notes never notify (nor resolve the ref), unassignment notifies nobody.
  Dedupe via UNIQUE(user_id, source_event_id). `GET /notifications/me` +
  `PATCH :id/read` (foreign id → 404; existence never leaks).
- **analytics-service (:3008)**, `helpdesk_analytics`: one snapshot row
  per ticket with a last-writer-wins guard enforced atomically in SQL
  (counters would double-count under at-least-once); late `created`
  events backfill metadata without regressing newer status; `resolved_at`
  tracks the current resolved stay. `GET /analytics/summary` (staff):
  totals, byStatus, byPriority, zero-filled 7-day window, user count.
- **api-gateway**: `/api/audit`, `/api/notifications`, `/api/analytics`;
  the proxy spec now drives all six downstreams from one table.
- **CI**: three more test databases and integration targets (7 total).
- **ADR 0006**: the outbox evaluation ADR 0005 committed to — deferred
  with explicit trigger conditions; also records that trail completeness
  has a consume side (DLQ without retry) an outbox cannot fix, and that
  `helpdesk_audit` is not an event store for rebuilds. data-ownership.md
  now documents a rebuild path per projection (including the auth listing
  gap) and the audit retention/erasure note.

## Validation results

| Check                                       | Result                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace gate (13 projects)                | format/lint/test/build/typecheck all passing                                                                                                                                                                                                                                                                                                        |
| Fast tests                                  | 146 total (+35: audit 10, notification 12, analytics 9, messaging +2, security +2)                                                                                                                                                                                                                                                                  |
| Integration tests                           | 21 total (+8: audit firehose records contracted + unknown types and dedupes on the real PK; notification full chain created→status→internal/public comment→assign with real dedupe index; analytics atomic LWW in real SQL incl. stale-replay rejection and out-of-order backfill; messaging firehose round-trip)                                   |
| Full-chain runtime E2E (production bundles) | 7 services; requester + promoted agent ran the whole lifecycle via the gateway: requester got exactly the 3 expected notifications (+ mark-read; agent got none — self-assign), audit trail served all 3 status transitions to the admin (403 for the requester), analytics summary showed the closed ticket and both users (403 for the requester) |
| CI on GitHub                                | **NOT VERIFIED** — still no remote                                                                                                                                                                                                                                                                                                                  |

## Findings

- **@Type() conversions silently dead in production bundles**: Nest's
  ValidationPipe loads class-transformer dynamically (loadPackage), which
  webpack cannot rewrite — bundling class-transformer gives DTO decorators
  a second, private copy whose metadata storage the pipe never sees.
  Under jest (single module registry) everything passed; the runtime E2E
  caught `?limit=20` answering 400. Fixed by keeping
  class-transformer/class-validator external in every service bundle
  (auth was already immune via `externalDependencies: 'all'`);
  tickets-service had the same latent bug on its untested take/skip
  params. Regression test added. Lesson recorded: DTO specs must include
  a VALID value that exercises the conversion, not just the rejection.
- **typecheck/build race on `dist/`**: `tsc --build` (typecheck) writes
  declarations into the same `dist/` webpack cleans, and a concurrent
  gate run left a stale tsbuildinfo without its .d.ts files — persistent
  TS6305 until `dist/` was deleted. Known flake shape now; a future
  sprint should split the typecheck output directory.
- The design-review workflow lost two of four reviewers to a session
  limit; their lenses (event semantics, operability) were covered inline
  and the surviving two (security, architecture) drove real design
  changes — the panel earned its cost.

## Intentionally deferred

Outbox (ADR 0006, with explicit triggers), retry tiers before DLQs + DLQ
depth monitoring, gateway-level rate limiting (proxies bypass Nest
guards; needs middleware), auth admin listing endpoint (prerequisite for
two rebuild paths), isStaff migration in tickets/users, notification/
dashboard UI in web, signup UI, push to remote + first real CI run.
