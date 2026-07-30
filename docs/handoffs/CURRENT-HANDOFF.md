# Current handoff

**Date:** 2026-07-30
**Sprint:** 9.0 — Close Sprint 8 and connect a model provider
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `main` at `6d2a94c` — Sprint 9.0 merged, pushed, remote CI green

## Git state

Sprint 9.0 is closed. `feat/ai-service` fast-forwarded onto `main` (ten
commits, no merge commit, no rewritten history) and was pushed. One
forward fix followed after the first remote run failed.

Four commits were created on `feat/ai-service` this sprint, on top of
`c6cc37b docs: record sprint 8 and the AI security posture`:

| Commit    | Message                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `b2f245b` | `ci: add typecheck to the quality gate`                                      |
| `b90eac6` | `feat(ai): add Gemini provider integration`                                  |
| `155b9c0` | `docs(product): document the API-ready AI capabilities and Sprint 8 closure` |
| `4b0a3c0` | `fix(ai): harden provider error redaction`                                   |

Then, on `main` after the merge:

| Commit    | Message                                      |
| --------- | -------------------------------------------- |
| `6d2a94c` | `fix(ai): track ai-service assets directory` |

`feat/ai-service` still exists and has not been deleted.

## Work completed

- **Google Gemini connected** behind the existing `AiProvider` port
  (ADR 0010), via the Interactions API with plain `fetch` — no SDK, no new
  dependency. `local` remains the default and the provider CI runs on.
- **`pnpm typecheck` added to the CI gate**, together with the broken
  type-only export it caught. `suggestions.controller.ts` imported
  `SuggestionOutput` from `domain/suggestion.ts`, which only imported it;
  that passed `lint`, `test` and `build` at HEAD.
- **The four AI capabilities moved from `in-development` to `api-ready`**
  on the public site, and `api-ready` itself was widened to mean "built,
  reachable, and not turned on" (ADR 0009).
- **Every document falsified by connecting a provider was corrected** —
  SECURITY.md, ADR 0009/0010/0011, README.md, four architecture notes and
  the Sprint 8 report, which had recommended `available` and was wrong.
- The incidental `apps/web/next-env.d.ts` change was reverted; it was
  `next dev` churn, not an intentional configuration change.

## Work incomplete / deliberately deferred

- **Usage ceilings, key rotation, rate limiting.** Named in SECURITY.md as
  unbuilt. These are the work standing between `api-ready` and
  `available`; do not promote the status before they exist.
- **Per-task model selection.** One model serves all four tasks.
- **`docs/roadmap/PRODUCT-ROADMAP.md`** does not exist. Creating it means
  publishing a forward plan — a product decision, not a documentation
  chore. It needs its own approval.
- **The provider-notice failure path.** If `GET /ai/provider` fails, the
  panel renders an error and _no_ provider notice, which drops the
  conservative "No language model is connected" disclosure instead of
  defaulting to it. Predates this sprint; found while tracing the runtime
  messaging.
- **Duplicate detection** stays `planned` — it needs embeddings and
  similarity search.

## Decisions made

- Gemini over other providers: free tier makes spend predictable, and
  `response_format.schema` takes standard JSON Schema that maps onto the
  existing per-task output schemas.
- Interactions API over `{model}:generateContent`, whose `responseSchema`
  accepts only an OpenAPI subset and would have needed a translation layer.
- `api-ready` over `available`: the panel exists, but nothing answers
  without an operator-supplied key and nothing is deployed.
- `api-ready` widened rather than adding a fifth status value.
- The `PROJECT_STATUS` "In development" column is omitted when empty
  instead of rendering a heading over nothing.

## Decisions pending

- Whether `docs/roadmap/PRODUCT-ROADMAP.md` should exist, and what it may
  publish.
- Whether the provider-notice failure path is worth its own fix.
- Whether to delete `feat/ai-service` now that remote CI is green.

## CI maintenance items

Not blocking, not part of any Sprint 9.0 change, and deliberately not
bundled into an unrelated fix:

- **`pnpm/action-setup@v4` targets Node.js 20**, which GitHub has
  deprecated; the runner forces it onto Node 24 and emits an annotation on
  every run. It is a warning today. Upgrade it on its own, when a workflow
  maintenance pass is the actual task — not folded into a product change.

## Files changed this sprint

**`ci: add typecheck to the quality gate`** — `.github/workflows/ci.yml`,
`apps/ai-service/src/domain/suggestion.ts`.

**`feat(ai): add Gemini provider integration`** —
`apps/ai-service/.env.example`, `src/config/env.ts`, `src/config/env.spec.ts`
(new), `src/infrastructure/providers/provider.factory.ts`,
`src/infrastructure/providers/gemini.provider.ts` (new),
`src/infrastructure/providers/gemini.provider.spec.ts` (new).

**`fix(ai): harden provider error redaction`** —
`apps/ai-service/src/domain/redaction.ts` (new),
`src/domain/redaction.spec.ts` (new), `src/domain/errors.ts`,
`src/app/app.module.ts`, `src/application/use-cases/generate-suggestion.ts`
and its spec, `src/infrastructure/providers/gemini.provider.ts` and its
spec, plus `SECURITY.md`, `docs/progress/SPRINT-009.0.md` and this file.

**`docs(product): …`** — `README.md`, `SECURITY.md`,
`apps/web/src/lib/product-status.ts`, `src/components/ai-suggestions.tsx`,
`src/components/public/hero-visual.tsx`, `src/app/(public)/page.tsx`,
`src/app/(public)/how-it-works/page.tsx`, `specs/landing.spec.tsx`,
`specs/how-it-works.spec.tsx`, `docs/adr/0009`, `0010`, `0011`,
`docs/architecture/{system-context,service-boundaries,local-development,frontend-design-system}.md`,
`docs/progress/SPRINT-008.md`, `docs/progress/SPRINT-009.0.md` (new), and
this handoff (new).

## Migrations

None. No schema change in this sprint.

## Tests executed

Full gate, all green on 2026-07-30:

- `pnpm format:check`, `pnpm lint` (0 errors, 9 pre-existing warnings),
  `pnpm typecheck` (13 projects), `pnpm test` (14 projects),
  `pnpm build` (14 projects).
- All 8 integration suites against real PostgreSQL and RabbitMQ:
  messaging, auth, tickets, users, audit, notification, analytics, ai.
- `ai-service` unit specs 52 → 95. `apps/web` 117, with 5 rewritten.
- Secret scan clean across tracked content and the full git history.
- **Remote GitHub Actions green** on `6d2a94c`: lint (14 projects),
  typecheck (13), test (14), build (14) and all 8 integration suites
  against real PostgreSQL and RabbitMQ service containers.

The run before it failed on `@helpdesk-ai/ai-service:build` because
`apps/ai-service/src/assets` was an empty, untracked directory. Local
verification cannot catch that class of break — the directory exists on
this machine. When a build target references a path, check that git
actually tracks it.

`apps/web` has no `typecheck` target — it is covered by `next build`
only. Worth knowing before trusting `pnpm typecheck` as total coverage.

## Services required to run this locally

`docker compose up -d` (PostgreSQL 5433, RabbitMQ 5672, Redis), then
auth-service, tickets-service, ai-service, api-gateway, web-bff and web.
`ai-service` needs a running `tickets-service` to read ticket context.

## Environment variable names (no values)

`apps/ai-service/.env`: `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`,
`RABBITMQ_URL`, `JWT_ACCESS_SECRET`, `TICKETS_SERVICE_URL`, `AI_PROVIDER`,
`GEMINI_API_KEY`, `GEMINI_MODEL`.

`GEMINI_API_KEY` is required only when `AI_PROVIDER=gemini`. The real
`.env` is git-ignored (`.gitignore:26`) and must never be staged.

## Known risks

- **The Gemini endpoint and model id rest on a smoke test from
  2026-07-30**, not on a check performed since. If a call starts failing,
  re-read the Interactions API docs before assuming a code fault.
- **Spend is now real.** Nothing throttles the gateway or BFF, so an
  authenticated staff account is a spending path. On the free tier,
  exhausting quota takes the feature down and surfaces as a 503.
- **Ticket text leaves the machine** when `AI_PROVIDER=gemini`. Internal
  notes never do.
- `apps/web/next-env.d.ts` flips between `.next/types/` and
  `.next/dev/types/` depending on whether `next dev` or `next build` ran
  last. The tracked version is the `next build` one. Do not commit the
  churn, and do not gitignore it either.
- Redaction is now a single boundary in `domain/redaction.ts`, applied in
  the `AiDomainError` base constructor. If you add an error type, it is
  covered automatically; if you add a new exit for error text that does
  **not** go through a domain error, it is not — route it through
  `redactSecrets` or `describeExternalError`.
- The pattern rules are deliberately narrow enough to keep ordinary
  diagnostics readable. A credential in a shape they do not recognize,
  from a provider whose key was never registered, would still pass. The
  registration in `AppModule.forRoot` is what covers the configured one.

## Exact next action

Sprint 9.0 is closed. Nothing is in flight. The next step is Sprint 9.1 —
the product domain and tenancy audit — on its own branch, and it needs
explicit approval before it starts.

## Resume commands

```bash
cd C:/Proyectos/helpdesk-ai
git branch --show-current      # expect main
git log --oneline -5
git status --short             # expect clean
docker compose up -d
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Suggested continuation prompt

> Sprint 9.0 is closed: the AI work is on `main`, remote CI is green, and
> the AI capabilities are published as API ready. Start Sprint 9.1 — the
> product domain and tenancy audit — on a branch off current `main`. It is
> an audit, so produce the current- and target-state domain maps, the
> permission matrix draft, the tenancy threat model and the migration risk
> register before changing any schema.

## Repository isolation

This project is developed in isolation: work on it touches
`C:\Proyectos\helpdesk-ai` and nothing else. No code, pattern or
configuration is carried in from another repository on this machine, and
none was during this sprint. Verify the root with
`git rev-parse --show-toplevel` before starting, and stop if it differs.

---

# Writing standard for this repository

This section is a permanent instruction, not a note about one sprint.
Later sessions should keep applying it.

The repository should read as if a person maintains it by hand, because
one does. Use a natural, direct, technically serious voice: someone who
understands the decisions being made, explains them clearly, is still
learning from the project, prefers practical language over academic
language, and documents tradeoffs honestly.

**Never fabricate** professional experience, previous employers,
customers, production incidents, team discussions, user research,
external approvals, commercial adoption, or personal anecdotes that did
not happen. The goal is an authentic project voice, not a fictional
history. Do not mention the author's age.

## Code comments

Review comments when touching a file. A comment earns its place when it
explains why a non-obvious decision exists, which invariant is protected,
why a simpler-looking alternative was rejected, which security boundary
must not be bypassed, why a compatibility layer is temporarily required,
which failure case motivated the implementation, or what must stay true
during a future refactor.

Remove or rewrite comments that are robotic, overly verbose, obvious from
the code, generic, duplicated by a type or function name, written like an
AI explanation of syntax, or no longer accurate.

Not this:

> Initialize the service dependency.
> This function returns the user.

This:

> Do not include internal notes here. Provider context is deliberately
> limited to requester-visible conversation.
> This compatibility path stays until every producer emits the v2 envelope.

Do not add informal comments to every file, and do not rewrite unrelated
comments to manufacture activity. A comment that is already accurate and
natural should be left alone.

## Markdown and architecture documentation

First-person reasoning is welcome where it adds ownership. Useful section
headings: _Why I chose this approach_, _What I considered_, _Why I did
not choose the simpler option_, _Tradeoffs_, _What is intentionally not
implemented yet_, _What I would revisit before production_, _What I
learned while implementing this_, _Current limitations_.

Good:

> I kept AI suggestions advisory because provider confidence is not a
> reliable authorization signal.

> I initially considered putting ticket text directly into RabbitMQ
> events. I rejected that for this sprint because it would duplicate
> sensitive content and create another retention boundary.

Avoid inflated language, excessive headings and lists, academic filler,
marketing language inside technical docs, "enterprise-grade" without a
concrete property behind it, "best practices" without naming which and
why, and repeated claims that the architecture is robust, scalable,
modern or production-ready.

Do not imitate a human by adding spelling errors, slang or inconsistent
formatting. Natural writing stays professional and readable.

## Documentation ownership

When a sprint changes an important decision, update the document that
owns it — the sprint report, the relevant ADR, the architecture note, the
security document, the roadmap, this handoff. Do not create another
small Markdown file that repeats what an existing one says.

Always distinguish: implemented, verified locally, API ready, deployed,
planned, intentionally deferred. **Never write that a feature is
available merely because its code exists.**

## Personal project perspective

About, Engineering, sprint retrospectives and selected decision documents
may reflect that this is a serious personal project built to learn and to
demonstrate professional software development — that the goal was not
another CRUD application, that fewer capabilities done correctly beat a
list of features that are not real, that some parts are deliberately
local or API ready until deployment is configured. Do not repeat this
context in every document, and keep operational and API documentation
objective.

## How to apply it

Progressively, inside the sprint you are working on: comments in files
you are already modifying, and the Markdown directly related to that
work. Remove clearly generated or outdated wording, preserve accurate
technical content, and do not start a repository-wide rewrite unless that
is itself an approved sprint.

End every sprint report by listing the documentation meaningfully
improved, which generated or obsolete wording was removed, and a
confirmation that no fictional experience or unsupported claim was
introduced.
