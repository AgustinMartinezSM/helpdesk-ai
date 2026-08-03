# Product Vision

Status: **written in Sprint 1 and deliberately not rewritten since.** It is
kept as the original statement of what the product was for, and most of it
still holds. What it says about _stage_ does not: "Planned" below means
planned in Sprint 1, and a great deal of it shipped.

Do not read a capability status from this file. The source of truth for what
the product can claim is `apps/web/src/lib/product-status.ts`
([ADR 0009](../adr/0009-public-product-status-representation.md)); how any of
it should be said is [brand-strategy.md](brand-strategy.md).

## Problem

Organizations that handle support requests — internal IT desks, customer support teams, service providers — need a single place to receive, triage, track, and resolve those requests. Without one, requests scatter across email and chat, ownership is unclear, priorities are guessed, and nobody can answer basic questions like "what is open, who is working on it, and how long is resolution taking".

HelpDesk AI is a help desk platform for managing support requests end to end, with AI assisting the support team along the way.

## What the platform will support

All items in this section are **Planned**. None are implemented as of Sprint 1.

### Core help desk (Planned)

- Authentication and user accounts.
- User profiles, technician accounts, and roles/permissions (requesters, technicians, administrators).
- Tickets with states, priorities, categories, and assignments.
- Public comments on tickets (visible to the requester) and internal notes (team-only).
- File attachments.
- Dashboard and statistics for workload and resolution metrics.
- Full ticket history and audit history: every state change, assignment, and edit is traceable.

### AI capabilities (Planned)

AI is a supporting capability, not the product. The platform must be a complete, usable help desk without any AI feature enabled; AI reduces the team's manual work on top of that. Five capabilities are planned:

1. **Summarization** — condense long ticket threads so a technician can pick up context quickly.
2. **Classification** — suggest a category for incoming tickets.
3. **Priority suggestion** — propose a priority based on ticket content.
4. **Suggested replies** — draft responses for the technician to review and send.
5. **Duplicate detection** — flag tickets that likely describe an already-reported issue.

In every case the AI suggests and a human decides. AI output never changes ticket state on its own.

## Current stage — as of Sprint 1

Left as written, because the point of this section now is the starting line
rather than the position. For where the project actually stands, read
`docs/progress/` and `docs/handoffs/CURRENT-HANDOFF.md`.

Sprint 1 delivered the platform foundation only:

- Nx/pnpm monorepo with three applications: `apps/web` (Next.js), `apps/web-bff` (NestJS), `apps/api-gateway` (NestJS).
- Shared libraries for environment validation (`libs/configuration`) and structured logging with request correlation (`libs/observability`).
- Health endpoints, local infrastructure via compose (PostgreSQL, Redis, RabbitMQ), code quality automation, and a CI workflow running on GitHub Actions (green on its first remote execution).

There is no authentication, no ticket model, and no domain feature of any kind yet. The gateway routes nothing because no downstream service exists.

## Non-goals for now

Explicitly out of scope at this stage:

- Any domain feature (auth, tickets, comments, attachments, dashboards).
- Any of the five AI capabilities.
- Distributed tracing (current request correlation is IDs only, by design).
- Multi-tenancy, billing, or SLA management — not designed yet; revisit when domain services exist.
- Public deployment. Everything runs locally.
