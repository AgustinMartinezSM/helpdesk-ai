# Sprint 8 — AI service (provider-agnostic)

Status: COMPLETE (2026-07-29), **except the model provider choice, which is
an open product-owner decision**. Everything the choice needs is in place;
see "Connecting a paid provider" at the end.

Goal: make AI assistance a real part of the platform — a service that
owns it, an API behind the gateway, and a staff-only panel in the ticket
UI — **without choosing the model provider**. The provider is a plug: a
deterministic local provider ships now, and connecting a paid provider
later is additive (ADR 0010).

## Scope decided with the product owner

| Question            | Decision                                                                   |
| ------------------- | -------------------------------------------------------------------------- |
| Capabilities        | Summary, classification, priority suggestion, reply draft (4)              |
| Duplicate detection | Out of scope — needs embeddings + vector search (own sprint)               |
| Ticket text source  | Synchronous read from `tickets-service` with the caller's token (ADR 0011) |
| Public site status  | AI moves from `planned` to `in-development` with an explicit note          |
| UI                  | Yes — web-bff routes plus a staff-only suggestions panel on the ticket     |

## Architecture

```
web (/tickets/[id] panel, staff only)
  └─> web-bff  /ai/*            (forwards the bearer, adds correlation)
        └─> api-gateway  /api/ai/*
              └─> ai-service :3009
                    ├─> tickets-service GET /tickets/:id   (caller's token)
                    ├─> AiProvider (local | future paid provider)
                    ├─> helpdesk_ai  (suggestions, append-only)
                    └─> ai.suggestion.created.v1 (best-effort publish)
```

- **Port**: `AiProvider.run({ task, context, limits })` → validated
  output. One method; prompts live in the adapter (ADR 0010).
- **Four tasks**, four zod output schemas in the domain. Off-schema
  provider output is rejected (502) and never stored.
- **Guardrails in the application layer**: context truncation, internal
  notes excluded, timeout, single attempt, staff-only.
- **Storage**: append-only suggestions with `provider`, `model`,
  `contextHash`, token usage, latency and `requestedBy`. No ticket text.
- **Events**: publishes `ai.suggestion.created.v1` (identifiers and
  metadata only — no content), which the audit firehose records
  automatically. No consumer in this sprint.

## What was built

Every item of the plan below shipped. Notable details:

- **`apps/ai-service` (port 3009)**, aligned with the existing service
  template: hexagonal layers, fail-fast env validation, helmet, no CORS,
  Swagger outside production, readiness that probes the database and
  reports the selected provider. It deliberately does **not** probe the
  provider: a readiness check that called a paid model on every poll would
  bill for monitoring.
- **Domain**: `SuggestionTask` (4), a closed `SUGGESTION_CATEGORIES`
  vocabulary owned here (tickets store a free-text category, so this
  service must not invent a constraint on another service's column), and
  one zod schema per task with hard limits.
- **`LocalHeuristicProvider` (`local` / `heuristics-v1`)**: keyword tables
  per category, urgency and patience signal lists, and templates. It
  reports `usage: null` because no tokens were spent, and every surface
  that shows its output names it.
- **`checkAiProviderContract`** (`provider-contract.ts`): the port's
  promises as plain functions returning violations — no test-framework
  globals, so a future adapter can be checked from a spec, an integration
  test or a script against a real provider.
- **UI**: staff-only panel on `/tickets/[id]`, four cards, per-task
  loading and error state, provider attribution on every suggestion, and a
  notice that says plainly that no language model is connected. Each
  button names its task in its accessible label, because four buttons
  labeled "Regenerate" are four identical stops for a screen reader.

### Verification

- Gate: `format:check`, `lint`, `test`, `build` green across all 14
  projects (10 apps + 4 libs).
- Tests: 52 unit specs in `ai-service`, 7 integration specs against real
  PostgreSQL, and `apps/web` from 108 to 117 (8 for the panel, 1 for the
  new landing status), plus 3 BFF passthrough specs and 3 messaging
  contract specs. All 8 integration targets pass (messaging + 7 services).
- End-to-end with 6 services up (auth, tickets, ai, audit, gateway, BFF)
  and the real browser: all four tasks generated through
  `web → bff → gateway → ai-service → tickets-service`; `403` for a
  requester on generate and read, `401` anonymous, `404` for an unknown
  ticket, `400` for an unknown task; `ai.suggestion.created.v1` recorded in
  the audit trail.
- **The redaction policy was verified as behavior, not intent**: adding an
  internal note to a ticket left the stored `contextHash` byte-identical,
  while adding a public reply changed it. That is the proof that internal
  notes never reach a provider.
- Panel measured, not eyeballed (the Sprint 7.6 lesson): no horizontal
  overflow at 375 px or 1280 px, no clipped blocks, and contrast composed
  through the ancestor chain — minimum 5.78:1 light, 5.43:1 dark.

## Work plan

1. Design docs: ADR 0010 (provider abstraction), ADR 0011 (ticket
   context access), this plan.
2. `apps/ai-service` scaffold aligned with the existing service template;
   `helpdesk_ai` + `helpdesk_ai_test`, role `ai_service`; compose, env
   examples, CI provisioning and an integration target.
3. Domain: suggestion entity, task vocabulary, category vocabulary,
   output schemas, errors.
4. Application: ports (provider, ticket context reader, repository,
   clock, publisher), context builder with guardrails, use cases
   (generate, list latest), unit specs with fakes.
5. Infrastructure: Prisma repository, local deterministic provider,
   HTTP ticket context reader, provider factory, reusable provider
   contract suite.
6. HTTP surface: staff-only controller, DTOs, domain error filter,
   health, Swagger; `/api/ai` route in the gateway.
7. `web-bff` `/ai/*` routes; `apps/web` suggestions panel with honest
   provider labeling; specs for both.
8. `product-status.ts`: the four capabilities become `in-development`
   with a note; update the specs that enforce "Planned".
9. Gate: format, lint, unit tests, build, integration tests against real
   PostgreSQL and RabbitMQ, and an end-to-end smoke run with the
   services up.

## Connecting a paid provider (the step after this sprint)

Everything below is the complete list of what the product owner's
decision unblocks. No provider SDK is installed until the choice is made.

1. Choose the provider and create an API key.
2. `pnpm add <sdk> --filter @helpdesk-ai/ai-service` (or use `fetch`
   directly — the port does not care).
3. Add the provider id to the `AI_PROVIDER` enum in
   `apps/ai-service/src/config/env.ts`, with its credentials required
   only when it is selected.
4. Add `src/infrastructure/providers/<id>.provider.ts` implementing
   `AiProvider`, and register it in `provider.factory.ts`.
5. Point the shared contract suite at it and run
   `nx test @helpdesk-ai/ai-service`.
6. Set `AI_PROVIDER=<id>` and the key in `apps/ai-service/.env`.
7. Move the four AI capabilities in `apps/web/src/lib/product-status.ts`
   from `in-development` to `available` (the panel exists), drop the "no
   language model is connected" notes, and update the specs that assert
   both — `landing.spec.tsx` and `how-it-works.spec.tsx` are written to
   fail until the site matches reality.

Nothing in the domain, application layer, controller, BFF or UI changes.

Decisions the choice still owes an answer to, none of which this sprint
could make on its own: which model per task (a summary and a reply draft
do not need the same one), the monthly ceiling and what happens when it is
reached, whether ticket text may leave the machine at all under the
provider's data-processing terms, and how the key is stored and rotated
(SECURITY.md lists this as open).

## Deliberately not done

- **Duplicate detection** — needs an embeddings port and similarity
  search (pgvector or equivalent); it is a different infrastructure
  decision and would have doubled the sprint.
- **Asynchronous pre-generation** — a suggestion waiting before a
  technician opens a ticket needs either `v2` contracts carrying ticket
  text or a service credential (ADR 0011 records the trigger to revisit).
- **Applying a suggestion** — no button changes a ticket. Accepting a
  category or priority stays a human action, and the service has no write
  path to `tickets-service` to make it otherwise.
- **Suggestion history UI** — the API serves it
  (`GET /ai/tickets/:id/suggestions/:task`), the panel shows only the
  newest per task.
- **Retries on provider failure** — one attempt, reported honestly. Retry
  tiers are a platform-wide open item, not an AI-specific one.
