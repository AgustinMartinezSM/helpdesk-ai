# Current handoff

**Date:** 2026-07-31
**Sprint:** 9.4 — phases 5 and 6 of the tenancy migration, complete
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `main`. `git log --oneline -15` is the source of truth for the
tip and for what is pushed; this file is for the things git cannot tell you.

Read `docs/progress/SPRINT-009.4.md` first — it now covers both halves of the
sprint — then `docs/architecture/tenancy-phase-7-readiness.md`, which is what
the next session most likely acts on.

## What is true now that was not yesterday

**Authorization is permission-based and the claims are load-bearing.**
`isStaff`/`isAdmin` and the duplicate `Actor` copies are deleted (ADR 0015,
amended). Call sites check keys from `PERMISSIONS` in `libs/security`;
`perms` in the token carries real values resolved from the membership's role
template through a code map in organizations-service. Seeded template rows
remain blocked on the template-vocabulary question — the map is the interim,
and the agent template carries three marked interim widenings (`read_all`,
`assign_agent`, flat `people.read`) that shrink when branches and teams
arrive. Agents deliberately LOST the analytics summary (approved matrix);
a test pins it.

**The membership lifecycle exists.** Transitions with no self-loops and
terminal `deactivated`, a version bump per transition (`mv` finally means
something), `membership.created.v1` / `membership.status-changed.v1` born
tenant-carrying, and an internal guarded status PATCH as the operator
surface. Suspension bites at the next refresh (refresh re-resolves, never
copies) with the one-TTL residual R7 accepted — except assignment, which
closes even that window by asking live.

**Every organization-owned read requires the tenant; every consumer reads
the tenant-carrying stream.** audit, analytics, notification: v2 processed
under `requireEnvelopeOrganization` (tenantless v2 dead-letters), v1 twins
acknowledged as explicit no-ops. Do NOT "clean up" the v1 no-op arms or drop
v1 contracts from subscriptions: the client only ever binds, never unbinds —
removing them either double-applies facts or strands deliveries. Phase 8
does queue surgery.

**The users directory is scoped through a projection.** `user_profiles`
still has no organization column on purpose (ADR 0013);
`directory_memberships` (fed by the membership events) is the scope, active
members only. Its rebuild path is `backfill-directory-memberships.sh`.

**Assignees are validated against live membership, fail-closed.**
tickets-service calls organizations-service's
`GET /internal/organizations/:orgId/memberships/:userId` with the internal
credential. ADR 0014's amendment draws the settled boundary: high-consequence
mutations may ask synchronously; read paths never do. Without
`ORGANIZATIONS_SERVICE_URL` + `INTERNAL_SERVICE_TOKEN` in tickets-service's
env, every assignment answers 503 — by design, and the boot log says so.

**The backfill sequence ran and verified clean on 2026-07-31.** 13 users =
13 memberships (2 organization_admin, 11 requester); directory projection
13 = 13; zero untenanted rows in all nine scoped tables; counts unchanged;
every id resolves; parents and children agree; everything on bootstrap. The
dev databases were already clean because only `_test` databases absorbed the
inter-phase churn — a deployed environment would NOT be, and must run the
same sequence. All five verifier checks now flip the exit code (they did
not before — subshell bug, fixed and commented).

## Phase 7 is prepared and NOT approved

`docs/architecture/tenancy-phase-7-readiness.md` has the constraint list,
precondition queries with current answers, ordering, rollback, and the one
open design point: `user_snapshots.organization_id` cannot be NOT NULL while
registration (anonymous by design) creates the row before the membership
event supplies the tenant — the honest cheap option is exempting it and
documenting nullable-by-design. **Do not start phase 7 without explicit
approval: it is the first step a code revert cannot undo.**

## Things that will bite you if you do not know them

- **Resolution fails closed on uncertainty only** (unchanged from the last
  handoff): cannot-ask → 503, belongs-nowhere → token without tenant claims,
  refused at the write with 403.
- **Tokens minted before this deploy carry `perms: []`** and are denied
  staff surfaces until refreshed — one TTL, self-healing, safe direction.
- **`INTERNAL_SERVICE_TOKEN` now lives in three `.env` files** (auth,
  tickets, organizations) and also guards a mutation (the status PATCH).
  Rotation and audit of internal calls are still not built; SECURITY.md now
  names this the first thing to close before any deployment.
- **The role-template mapping is written twice** — unchanged:
  `backfill-bootstrap-memberships.sh` and `roleTemplateFromGlobalRoles` in
  organizations-service must change in the same commit.
- **Rows with NULL organization_id are invisible to every tenant** in audit
  and notification reads until the backfill runs. That is deliberate;
  the scripts exist and are idempotent.
- **`backfill-tenant-columns.sh` refuses to run once a second organization
  exists** (R4). That is a feature; do not "fix" it.
- **Adding a service still means editing `ci.yml` twice** (unchanged).
- **apps/web's client-side staff boolean** (`[id]/page.tsx`) still keys on
  role strings; it drifts from server policy the day roles and permissions
  diverge for some user. Phase 8 / the role-experience sprint owns it.

## Work incomplete / deliberately deferred

- **Phase 7** (above). **Phase 8**: stop publishing v1, remove no-op arms +
  bindings, drop the `roles` claim and users-service's projected `roles`
  column, scope the rebuild procedures (R13).
- **R9 beyond tickets-service:** other integration suites still teardown
  with unfiltered `deleteMany()`.
- **`mv` is minted and bumped but nothing compares it** — its purpose
  narrowed to "cheap staleness signal between TTL-tolerant and ask-live"
  (ADR 0014 amendment).
- **No organization selector / token exchange** (unchanged; resolution picks
  the oldest active membership).
- **Role-template vocabulary + scope qualifiers** still undecided; blocks
  seeded template rows.
- Sprint 9.0 leftovers unchanged: AI usage ceilings/key rotation/rate
  limiting before `available`; `docs/roadmap/PRODUCT-ROADMAP.md` still a
  product decision; provider-notice failure path; `feat/ai-service` branch
  deletion still open.

## Decisions made this session (all documented in place)

- Synchronous membership verification for high-consequence mutations only
  (ADR 0014 amendment) — assignment is the first.
- Permission evaluator v1 = code map, not seeded rows; interim agent grants;
  analytics narrowing applied (ADR 0015 amendment).
- Consumers ack v1 as no-op on the same queue rather than rebinding.
- Membership events are born tenant-carrying (no v1/v2 window);
  `requireEnvelopeOrganization` is the consume-side guard.
- Directory lists active members only, until people-management decides how
  to present other statuses.
- `user_snapshots` keeps one row per user; organization stamped by
  `membership.created.v1`, row created from the membership event if the
  registration event was lost.
- `deactivated` is terminal; reactivation policy belongs to the
  people-management sprint.
- Assignment refusals are one generic 422 (cause-blind, so membership facts
  do not leak); verification unavailability is 503.

## Migrations added this session

- audit-service `20260731120837_add_organization_index` — scoped read index.
- analytics-service `20260731120000_scope_analytics_to_organization` —
  `user_snapshots.organization_id` (nullable, backfilled) + both indexes.
- notification-service `20260731151205_scope_reads_by_organization` —
  `[user_id, organization_id, created_at]` replaces `[user_id, created_at]`.
- users-service `20260731120000_add_directory_memberships` — the projection
  table.

All applied locally (dev and `_test`). organizations-service needed no
migration — lifecycle uses existing columns.

## Tests executed (2026-07-31, local)

Full gate green: `format:check`, `lint`, `typecheck`, `test`, `build` across
all projects. All nine integration suites green against real PostgreSQL and
RabbitMQ, including the new coverage: audit's DLQ proof for tenantless v2,
analytics' two-organization summaries and membership-stamped user snapshots,
notification's mismatch-dead-letters flow, users' end-to-end scoped
directory, organizations' lifecycle events on a real broker. The backfill
sequence and its verification are recorded above and in the readiness
document. Remote CI: check `gh run list` for the run on the pushed tip; the
docs commit recording it lands after this file.

## Services required to run locally

`docker compose up -d`, then the services you need. New since yesterday:
tickets-service wants `ORGANIZATIONS_SERVICE_URL` + `INTERNAL_SERVICE_TOKEN`
(byte-identical to organizations-service's) or assignment answers 503.
users-service now also consumes membership events; run organizations-service
if you want the directory projection fed live.

## Environment variable names (no values)

Unchanged except: `apps/tickets-service/.env` gains
`ORGANIZATIONS_SERVICE_URL`, `INTERNAL_SERVICE_TOKEN`. Every real `.env` is
git-ignored and must never be staged.

## Known risks

- The local database volume was hand-provisioned (unchanged warning: do not
  delete the volume).
- Gemini endpoint/model id still rest on the 2026-07-30 smoke test; ticket
  text still leaves the machine with `AI_PROVIDER=gemini`; gateway/BFF still
  unthrottled.
- `apps/web/next-env.d.ts` churn (unchanged: tracked version is `next build`).
- `pnpm/action-setup@v4` Node 20 deprecation warning (unchanged).
- The verifier and backfill scripts hardcode local-only passwords; they are
  operator tools for the local/CI shape only.

## Exact next action

Present phase 7 for approval using
`docs/architecture/tenancy-phase-7-readiness.md` (including the
`user_snapshots` exemption choice). If approved: one migration per service,
`SET NOT NULL` guarded by the idempotent UPDATE, then make
`Actor.organizationId`/`permissions` required and fix what the compiler
surfaces, then re-run the verifier. If not: phase 8 cleanup or Sprint 9.5
(branches) are both unblocked by this session's work — the dependency map
prefers finishing enforcement first.

## Resume commands

```bash
cd C:/Proyectos/helpdesk-ai
git branch --show-current      # expect main
git log --oneline -15
git status --short             # expect clean
docker compose up -d
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Suggested continuation prompt

> Continue the HelpDesk AI tenancy migration. Phases 5 and 6 are complete and
> merged on `main`: permission-based authorization (isStaff is gone), the
> membership lifecycle with tenant-carrying events, consumers on the v2
> stream with v1 acked as no-ops, the directory scoped through a projection,
> assignee validation fail-closed, and the backfill re-run verified clean.
> Read `docs/progress/SPRINT-009.4.md` and
> `docs/architecture/tenancy-phase-7-readiness.md` before touching anything.
>
> Next: decide phase 7. It is the first irreversible step (`NOT NULL`), it
> is prepared but NOT approved, and the readiness document contains the one
> open design point (`user_snapshots` exemption). Do not remove the v1 no-op
> consumer arms, do not drop v1 contracts from subscriptions, and do not
> seed role-template rows — the vocabulary question is still open and the
> code map in organizations-service is the deliberate interim.

## Repository isolation

This project is developed in isolation: work on it touches
`C:\Proyectos\helpdesk-ai` and nothing else. No code, pattern or
configuration is carried in from another repository on this machine, and
none was during this session. Verify the root with
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
