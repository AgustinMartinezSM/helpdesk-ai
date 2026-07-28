# Sprint 4 — Tickets Domain Core

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-28.

## Goal

The heart of the product: ticket lifecycle with real domain rules inside tickets-service, over its own `helpdesk_tickets` database, authorized by auth-service access tokens.

## Scope completed

- **Domain**: statuses (`open`, `in_progress`, `resolved`, `closed`) with an explicit transition map; priorities; role rules (`isStaff`, `canView`); client-safe errors. Notable rules: closed is terminal; a requester may only close their own resolved ticket; non-owners get 404 (not 403) so ticket existence never leaks; internal notes are staff-only in both directions.
- **Application**: `CreateTicket`, `GetTicket` (comments filtered by role + full history), `ListTickets` (requesters always scoped to their own; staff filter by status/assignee; paginated), `ChangeTicketStatus`, `AssignTicket`, `AddComment`. Every mutation appends a history entry atomically with the change (single transaction in the repository).
- **Infrastructure**: Prisma 7 schema (`tickets`, `ticket_comments`, `ticket_history` with PG enums), migration `20260728044617_init`, repository adapter with transactional history. `helpdesk_tickets` / `_test` provisioned (init script for fresh volumes + applied idempotently to the live one).
- **Presentation**: JWT-guarded `/tickets` API (create/list/get/status/assignee/comments) — the guard verifies tokens **signed by auth-service** (shared HS256 secret, documented tradeoff), class-validator DTOs, domain-error filter (404/403/409), Swagger at `/docs`.
- **CI**: tickets provisioning + integration tests added to the workflow.

## Validation results

| Check                            | Result                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace gate (7 projects)      | format/lint/test/build/typecheck all passing                                                                                                                                       |
| Fast tests                       | 14 new (domain transitions, use-case authorization, HTTP API with fakes + real JWT verification) — 67 fast total across the workspace                                              |
| Integration tests                | 4 new against `helpdesk_tickets_test` (enum/nullable round-trips, filtered pagination, transactional history, internal-comment separation) — 10 integration total                  |
| Runtime E2E (production bundles) | tickets readiness probes its DB; a token minted by auth-service was accepted by tickets-service; ticket created/listed with history; requester blocked from the lifecycle with 403 |
| CI on GitHub                     | **NOT VERIFIED** — still no remote                                                                                                                                                 |

## Findings

- The `class-transformer/storage` webpack probe recurs in every service using @nestjs/swagger; the IgnorePlugin fix is now applied per service (candidate for a shared webpack helper when a third case appears — the same threshold used for the duplicated JWT guard).
- Nx cache/daemon produced one stale failed typecheck after heavy file churn; `nx sync` + uncached rerun confirmed green (flagged as flaky by Nx itself).

## Intentionally deferred

Gateway routing for `/api/tickets/*`, BFF/web tickets UI, RabbitMQ ticket events (`ticket.created.v1`, ...), attachments, users-service, notification/audit/analytics consumers, AI capabilities.
