# Current handoff

**Date:** 2026-07-30
**Sprint:** 9.0 — Close Sprint 8 and connect a model provider
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `feat/ai-service` (9 commits ahead of `main`, never pushed)

## Git state

Three commits were created on `feat/ai-service` this sprint, on top of
`c6cc37b docs: record sprint 8 and the AI security posture`:

| Commit    | Message                                                                      |
| --------- | ---------------------------------------------------------------------------- |
| `b2f245b` | `ci: add typecheck to the quality gate`                                      |
| `b90eac6` | `feat(ai): add Gemini provider integration`                                  |
| _(this)_  | `docs(product): document the API-ready AI capabilities and Sprint 8 closure` |

`main` is unchanged and still equal to `origin/main`. Nothing has been
merged or pushed; both are waiting on explicit approval.

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

- Merge `feat/ai-service` into `main` with `--ff-only`, then push.
- Whether to verify the remote GitHub Actions run before or after merge.
- Whether `docs/roadmap/PRODUCT-ROADMAP.md` should exist, and what it may
  publish.
- Whether the provider-notice failure path is worth its own fix.

## Files changed this sprint

**`ci: add typecheck to the quality gate`** — `.github/workflows/ci.yml`,
`apps/ai-service/src/domain/suggestion.ts`.

**`feat(ai): add Gemini provider integration`** —
`apps/ai-service/.env.example`, `src/config/env.ts`, `src/config/env.spec.ts`
(new), `src/infrastructure/providers/provider.factory.ts`,
`src/infrastructure/providers/gemini.provider.ts` (new),
`src/infrastructure/providers/gemini.provider.spec.ts` (new).

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

- `pnpm format:check`, `pnpm lint` (0 errors, 8 pre-existing warnings),
  `pnpm typecheck` (13 projects), `pnpm test` (14 projects),
  `pnpm build` (14 projects).
- All 8 integration suites against real PostgreSQL and RabbitMQ:
  messaging, auth, tickets, users, audit, notification, analytics, ai.
- `ai-service` unit specs 52 → 71. `apps/web` 117, with 5 rewritten.
- Secret scan clean across tracked content and the full git history.

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
- `apps/ai-service/src/application/use-cases/generate-suggestion.ts`
  wraps any non-domain provider error and the filter returns its message
  verbatim to the caller. Redaction happens one layer below, inside the
  adapter, so the guarantee rests on each adapter's discipline and no
  test asserts containment at the use-case boundary. A future provider
  that leaks a raw error would reach the browser.
- `redact()` masks the exact key string only. An upstream that echoed a
  percent-encoded or case-altered rendering would pass through. Google's
  invalid-key response does not echo the key, so this is defense in
  depth rather than a live gap.

## Exact next action

Report the sprint result and wait for approval to merge. Nothing else.

## Resume commands

```bash
cd C:/Proyectos/helpdesk-ai
git branch --show-current      # expect feat/ai-service
git log --oneline -4
git status --short             # expect clean
docker compose up -d
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Suggested continuation prompt

> Sprint 9.0 is committed on `feat/ai-service` and the full gate plus all
> 8 integration suites are green. Review the branch diff against `main`.
> If you approve, merge with `--ff-only`, push, and verify the remote
> GitHub Actions run — the new `pnpm typecheck` step has not run on the
> remote yet. Do not start Sprint 9.1 until that passes.

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
