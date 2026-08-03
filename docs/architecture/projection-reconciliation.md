# Projection reconciliation — operator runbook

Status: **implemented in Sprint 9.16, verified locally against the compose
stack.** Nothing is deployed; the procedures below are written for whoever
first runs this platform somewhere real, and they were exercised against local
PostgreSQL and RabbitMQ rather than a hosted environment.

Scope: tickets-service's structure projections — `branch_refs`,
`station_refs`, `team_refs` and `team_branch_refs` — rebuilt from
organizations-service, which owns the data. **No other projection in the
platform has a reconciliation path**; see "What this does not cover" at the
end, because assuming otherwise is the mistake this document is most likely to
cause.

## Why this exists

A consumer's durable queue is declared when the consumer first boots, and a
topic exchange **discards** a message with no bound queue. So a service started
for the first time after its producers have been working has an empty
projection and fills only from the next event.

For tickets-service that is not a cosmetic staleness. `CreateTicketUseCase`
validates `branchId` against `branch_refs` and refuses an unknown one with a
generic 422, fail-closed by design (Sprint 9.5, D4). A cold tickets-service
therefore **refuses every located ticket** until somebody edits each branch
upstream to make it re-emit an event — which is a person doing by hand what
nothing does automatically, one row at a time, with no way to know when they
are finished.

The mechanism is three read-only snapshot endpoints on organizations-service
and a walk on the tickets side. tickets-service never reads another service's
database (ADR 0003); it asks the owner over HTTP.

## Before you start

Both services must be running, and tickets-service needs two variables:

| Variable                    | Where                 | Effect if missing                                                                              |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `ORGANIZATIONS_SERVICE_URL` | tickets-service       | Reconciliation is not wired at all. The boot log warns, and the endpoints below answer **503** |
| `INTERNAL_SERVICE_TOKEN`    | tickets-service       | Same as above — both are required together                                                     |
| `INTERNAL_SERVICE_TOKEN`    | organizations-service | Its value must match the one tickets-service presents, or every snapshot read answers **401**  |

The credential is the one Sprint 9.11 left holding two read-only membership
lookups. It is rotatable through `INTERNAL_SERVICE_TOKEN_PREVIOUS` on both
sides (runbook in `SECURITY.md`), and the api-gateway strips
`x-internal-service-token` from every inbound request, so nothing below is
reachable from a browser.

Default local ports: organizations-service `3010`, tickets-service `3004`.

## 1. Bootstrap — what happens without anybody asking

tickets-service reconciles on **every** boot, right after its structure-events
subscription is live. Nobody has to notice a cold start; this is the part that
fixes it.

The order is the whole safety argument and it lives in one place,
`StructureEventsConsumer.onApplicationBootstrap`:

1. `subscribe()` resolves only once the queue is declared and bound, so from
   that moment nothing published can be discarded — it waits in the queue.
2. Only then is the snapshot read, and every row is applied through the same
   last-write-wins guard the events use (`stored.updated_at <= incoming`).

So an update published before the read is already in the snapshot; one
published after is queued and applied later, winning on its newer timestamp;
one published during is in the snapshot, the queue, or both, and last-write-wins
settles it either way. **Never reverse those two calls.** Snapshot-then-subscribe
reopens exactly the window this closes.

Reconciliation is fire-and-forget, like every consumer here: it never blocks
HTTP readiness, and a broker or snapshot failure delays the projection instead
of failing startup.

Confirm it ran by reading the boot log for these lines, in this order:

```
consuming structure events from tickets-service.structure-events
structure reconciliation branches scanned=… inserted=… updated=… unchanged=… archived=… orphaned=… failed=0; stations …; teams …
```

If instead you see:

```
structure reconciliation is not configured: a cold projection will only fill from new events
```

then the two variables above are not both set. That is a warning rather than
silence on purpose — it is precisely the cold-start hole this exists to close.

## 2. Integrity check — read everything, write nothing

A `GET` is a dry run. It reads the whole snapshot, writes nothing, and reports
the same counters a repair would produce.

```bash
curl -s -H "x-internal-service-token: $INTERNAL_SERVICE_TOKEN" \
  http://localhost:3004/internal/projections/structure
```

```json
{
  "dryRun": true,
  "branches": {
    "scanned": 12,
    "inserted": 0,
    "updated": 0,
    "unchanged": 12,
    "archived": 2,
    "orphaned": 0,
    "failed": 0
  },
  "stations": {
    "scanned": 30,
    "inserted": 0,
    "updated": 0,
    "unchanged": 30,
    "archived": 0,
    "orphaned": 0,
    "failed": 0
  },
  "teams": {
    "scanned": 4,
    "inserted": 0,
    "updated": 0,
    "unchanged": 4,
    "archived": 1,
    "orphaned": 0,
    "failed": 0
  },
  "complete": true
}
```

**A healthy projection answers `inserted: 0` and `updated: 0` on every
projection, with `complete: true`.** That is the whole test. Anything else is
drift, and the next section says what to do about it.

Run it whenever you want to know, and specifically: after deploying
tickets-service for the first time in an environment, after a broker outage,
after restoring a database, and before believing a bug report that says tickets
cannot be filed at a branch.

## 3. Reconciliation — repair

A `POST` does the same walk and writes.

```bash
curl -s -X POST -H "x-internal-service-token: $INTERNAL_SERVICE_TOKEN" \
  http://localhost:3004/internal/projections/structure/reconcile
```

It answers the same shape with `"dryRun": false`. Run the dry run again
afterwards: a successful repair makes the next check report zeros.

**Re-running is always safe**, and that is the recovery mechanism rather than a
convenience. Every write is idempotent under last-write-wins, so there is no
half-applied state to unwind and no cursor to persist. An interrupted run is
recovered by running it again from the beginning.

For a very large walk you may resume instead of restarting, per projection:

```bash
curl -s -X POST -H "x-internal-service-token: $INTERNAL_SERVICE_TOKEN" \
  "http://localhost:3004/internal/projections/structure/reconcile?branchesAfter=<last-branch-id>&stationsAfter=<last-station-id>&teamsAfter=<last-team-id>"
```

Two things to know about resuming. The cursors are ids, and they are a
convenience — if you are unsure, pass nothing. And a resumed run **does not
report orphans**: it never saw the pages before its cursor, so every earlier row
would look orphaned. `orphaned` is only meaningful on a walk that started at the
beginning and finished without a failed page.

## 4. Reading the result

| Counter     | Means                                                                              |
| ----------- | ---------------------------------------------------------------------------------- |
| `scanned`   | Rows the source offered on this walk                                               |
| `inserted`  | Rows that did not exist locally. **On a warm projection this should be 0**         |
| `updated`   | Local rows older than the source's timestamp. **Also 0 on a warm one**             |
| `unchanged` | Local rows already at or ahead of the source — the ordinary case                   |
| `archived`  | Rows whose status arrived as `archived`; a subset of the three above, not an error |
| `orphaned`  | Local rows the source did not offer. **Counted, never deleted**                    |
| `failed`    | Pages or rows that threw. Any non-zero value makes `complete` false                |

What each result means in practice:

- **All zeros except `unchanged`** — the projection matches its source. Nothing
  to do.
- **`inserted` large, on a fresh deployment** — the cold start, working. Expect
  it exactly once per environment; expect zero on the next boot.
- **`inserted` or `updated` non-zero on a service that has been running** —
  events were lost. The likely causes are a broker outage while
  organizations-service published (there is no outbox — ADR 0006, so a publish
  during an outage is logged and gone) or a dead-lettered message. Check
  `tickets-service.structure-events.dlq` in the RabbitMQ management UI before
  concluding it was the broker.
- **`orphaned` non-zero** — a local row exists that the source did not offer.
  **Nothing removes it, on purpose.** The domain never deletes: branches and
  teams are archived, and archiving does not cascade (Sprint 9.11, D4), so an
  unexplained local row is a fact rather than a deletion to mirror. Removing it
  automatically would be repairing an ambiguous record. Investigate — a row
  from a deleted test tenant and a row from a bug look identical to this
  counter — and delete by hand if you decide it should go.
- **`failed` non-zero / `complete: false`** — part of the walk did not happen.
  The projection may still be incomplete; see the next section, fix the cause,
  and run it again. A failed page **ends that projection's walk** rather than
  skipping ahead, because continuing past it would advance the cursor over rows
  nobody read and report a clean finish with a hole in it. The other two
  projections still run.

## 5. When it fails

| Symptom                                                                                                      | Cause                                                                                                 | What to do                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `503 structure reconciliation is not configured`                                                             | `ORGANIZATIONS_SERVICE_URL` or `INTERNAL_SERVICE_TOKEN` missing on tickets-service                    | Set both and restart. 503 rather than 404 is deliberate: the route exists, the dependency does not, and a retry will work                                     |
| `401` from the reconcile endpoint itself                                                                     | Your `x-internal-service-token` header is wrong or absent                                             | Use tickets-service's own value. It is the same credential in both directions                                                                                 |
| Log: `structure snapshot unavailable: branches answered 401`                                                 | The two services disagree about the credential — commonly a half-finished rotation                    | Set `INTERNAL_SERVICE_TOKEN_PREVIOUS` on organizations-service to the value being retired, then promote (`SECURITY.md`)                                       |
| Log: `… answered 404`                                                                                        | `ORGANIZATIONS_SERVICE_URL` points at the api-gateway, or at the wrong service                        | Point it directly at organizations-service. `/internal/*` is absent from the gateway's routing table and the gateway strips the header                        |
| Log: `… answered 500`                                                                                        | organizations-service failed while reading its own database                                           | Read that service's log. Nothing on the tickets side can fix it                                                                                               |
| `structure snapshot unavailable:` followed by an abort or timeout message                                    | The snapshot read exceeded its 30s bound                                                              | Usually a slow or unreachable organizations-service. Re-run after it recovers; the read is bounded on purpose so a hung hop cannot hold the walk open forever |
| `structure snapshot unavailable:` followed by a fetch error, with a proxy or TLS hop in front of the service | Something answered 3xx. The fetch sets `redirect: 'error'`, so the request fails instead of following | Deliberate: a followed redirect would re-send the service credential to whatever host answered. Point the URL at organizations-service directly               |
| Log: `… answered an unexpected shape`                                                                        | organizations-service's snapshot response changed                                                     | This is the parse refusing to write `undefined` into the projection that decides whether tickets can be filed. Fix the contract; do not loosen the parse      |
| `400 after must be a uuid`                                                                                   | A malformed resume cursor                                                                             | Drop the cursor and run from the beginning — always safe. The 400 exists so a bad cursor is not silently treated as "start over"                              |
| Reconcile is clean but a located ticket is still refused                                                     | The branch is `archived`, or the ticket names a branch belonging to another organization              | Neither is a projection fault: both refusals are correct. Check `status` and `organization_id` on the row (query below)                                       |

The counters and the logs carry counts and organization ids only — never a
branch name, a code or anything about a ticket — so they are safe to read in an
aggregated log.

To look at the projection directly (local compose stack, container on port
5433):

```bash
psql "postgresql://tickets_service:helpdesk_local_only_tickets@localhost:5433/helpdesk_tickets" \
  -c "select organization_id, status, count(*) from branch_refs group by 1,2 order by 1,2;"
```

The four tables are `branch_refs`, `station_refs`, `team_refs` and
`team_branch_refs`. On a cold service they are empty, which is the fastest
confirmation of the diagnosis before you run anything.

## 6. Safe recovery, and what not to do

- **Re-run from the beginning.** It is idempotent and it is the intended
  recovery for every partial or failed run.
- **A dry run first, if you want to know before you write.** It reads the same
  rows and reports the same numbers.
- **Do not delete projection rows to "force a rebuild".** Deleting
  `branch_refs` makes every located ticket unfileable until the walk finishes,
  and the walk would have corrected those rows in place anyway. There is no
  case where truncating helps.
- **Do not reverse subscribe-then-reconcile.** It is the reason no update can
  be lost across the handover, and reversing it reintroduces a silent gap that
  no test failure would announce.
- **Do not make reconciliation delete anything.** Orphans are reported so a
  person can decide. An automatic delete here would remove rows on the strength
  of one HTTP response.
- **Do not point tickets-service at another service's database.** The snapshot
  is HTTP from the owner precisely so this stays impossible (ADR 0003).
- **Do not turn the snapshot endpoints into a general cross-service data
  layer.** They are three specific reads for four specific projections, and
  that boundary is what keeps them safe to expose.

## What this does not cover

Stated plainly, because the sprint that built this fixed one projection and not
the class of problem:

- **users-service `directory_memberships`, analytics-service
  `ticket_snapshots` / `user_snapshots`, and notification-service
  `ticket_refs` have no reconciliation path.** They have the same cold-start
  exposure. Their documented rebuild paths in
  `docs/architecture/data-ownership.md` are HTTP refetches with known gaps, not
  an equivalent of this. `docs/architecture/pilot-readiness.md` keeps that open.
- **Departments are deliberately not projected by tickets-service, and there is
  no `department_refs` to reconcile.** A department is the requester's
  organizational area; it has no bearing on ticket validation or routing, and
  it publishes no event contract at all — ADR 0022 states the rule as "no
  consumer, no promise". Do not add one to make this document symmetrical.
- **No scheduler.** Nothing runs the check periodically; there is no scheduler
  anywhere in this repository. It runs at boot and when an operator asks.
- **No metrics or alerts.** The result is a log line and an HTTP response, so
  drift is found by somebody looking. That is the same gap
  `pilot-readiness.md` records for everything else.

## Where the rules live

- `docs/progress/SPRINT-009.16.md` — the decisions D1–D11 and what was rejected.
- ADR 0003 — no service reads another's database; the snapshot is why that
  still holds for a rebuild.
- ADR 0005 — the messaging properties this composes: queue binding, and
  last-write-wins on the source's own timestamp.
- ADR 0013 — organizations-service owns the structure graph; these projections
  are caches of it.
- ADR 0022 — why departments are absent.
- `SECURITY.md` — the credential and its rotation.
