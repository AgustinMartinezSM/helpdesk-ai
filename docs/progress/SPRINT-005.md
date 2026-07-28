# Sprint 5 — Tickets Through the Web Path

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-28.

## Goal

Make tickets usable by humans: route them through the gateway, expose them to the browser through the BFF, and give the web app a real tickets UI.

## Scope completed

- **api-gateway**: the auth proxy generalized into `createServiceProxy` (pathFilter + rewrite + fixRequestBody); `/api/tickets/*` now routes to tickets-service via validated `TICKETS_SERVICE_URL`. One spec covers both routes, nested paths, bodies, correlation and gateway-owned routes.
- **web-bff**: `GatewayAuthClient` renamed to `GatewayClient` (it now serves two domains) and moved out of the session folder; `/tickets` endpoints forward the browser's bearer token, query filters and correlation to the gateway. Domain validation deliberately stays in tickets-service — the BFF is a thin composition layer and duplicating DTO rules would let them drift.
- **web**: `/tickets` (list with status/priority), `/tickets/new` (create form with priority select), `/tickets/[id]` (detail with description, comments, add-comment form and full history). Staff see lifecycle buttons mirroring the domain's transition map; requesters see exactly one action — "confirm fix and close" on their own resolved ticket. Anonymous visitors are prompted to sign in; the tickets API is never called without a session.

## Validation results

| Check                                       | Result                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace gate (7 projects)                 | format/lint/test/build/typecheck all passing                                                                                                                                                     |
| Fast tests                                  | 10 new (gateway dual-proxy 3, BFF passthrough 3, web tickets UI 3, plus reworked proxy coverage) — 75 fast total                                                                                 |
| Integration tests                           | 10 total (unchanged; no new persistence)                                                                                                                                                         |
| Full-chain runtime E2E (production bundles) | register via gateway; login via BFF cookie session; ticket created, commented, fetched and listed **through bff → gateway → tickets-service** with the browser bearer token; 401 without a token |
| CI on GitHub                                | **NOT VERIFIED** — still no remote                                                                                                                                                               |

## Findings

- One workspace-gate run failed spuriously when `pnpm format` ran concurrently with cached tasks; the clean rerun passed. Format now runs strictly before the gate in the local flow.

## Intentionally deferred

Assignee picker UI (needs users-service for agent identities), pagination controls, RabbitMQ events, signup UI, push to remote.
