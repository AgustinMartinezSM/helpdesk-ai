# Current handoff

**Date:** 2026-07-31
**Sprint:** 9.4 — the tenancy migration, complete (phases 0–8)
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `main`. `git log --oneline -20` is the source of truth for the
tip and for what is pushed; this file is for the things git cannot tell you.

Read `docs/progress/SPRINT-009.4.md` first — it covers the whole sprint,
including phases 7 and 8 — then `docs/architecture/tenancy-phase-7-readiness.md`
for the enforcement record.

## The migration is done. What that means concretely

**Authorization is permission-based end to end.** `Actor` is one type in
`libs/security`: `permissions` is required (an empty set is a decision, and
it denies), `organizationId` is deliberately optional — a token for an
account that belongs to no organization yet is a real minted state
(registration→membership is racy and the product preserves it), and the
refusal lives in `requireOrganization` at the domain boundary. `perms`
resolves from the membership's role template through the code map in
organizations-service; seeded template rows remain blocked on the
template-vocabulary question. The agent template carries three marked
interim widenings (`read_all`, `assign_agent`, flat `people.read`) that
shrink when branches and teams arrive.

**There is no `roles` claim.** Phase 8 removed it; the login/refresh/me
responses keep `user.roles` from the user row (display data — apps/web and
the BFF consume exactly that, verified). users-service dropped its projected
`roles` column. The `user.registered.v1` contract still carries roles and
organizations-service still reads them — mapping legacy roles into a first
membership is what that consumer is for.

**The database refuses an untenanted row** in seven tables (tickets,
ticket_comments, ticket_history, suggestions, ticket_snapshots, ticket_refs,
notifications). Two are nullable **by design**, not by omission:
`user_snapshots` (registration creates the row before the membership event
supplies the tenant) and `audit_events` (the firehose records the
structurally tenantless `user.registered.v1` forever). Their scoped reads
already exclude nulls, and the verifier prints their null counts as
informational. Rollback past phase 7 is a forward migration
(`DROP NOT NULL`), not a `git revert`.

**v2 is the only published revision of the five ticket/AI contracts.** The
v1 contracts are deleted; `user.registered.v1` lives on (anonymous facts
have no v2 to move to). Durable queues self-heal: subscriptions declare
`retiredBindingKeys` and every boot unbinds them idempotently — do NOT
remove those string literals until every environment's durable queue has
booted this version at least once, or a stale binding feeds the DLQ
indefinitely. Any environment with a v1 backlog at first boot will
dead-letter it as inspectable "no contract bound" letters; the v2 twins
already processed, so those can be purged.

**Everything else from phases 5–6 stands**: reads require the tenant from
the token, writes take it from the token, consumers dead-letter tenantless
tenant-carrying envelopes, notification compares tenant as well as id, the
directory is scoped through the `directory_memberships` projection, the
membership lifecycle publishes born-tenant-carrying events and bumps `mv`,
and assignment re-validates the assignee against live membership,
fail-closed (ADR 0014's amendment: high-consequence mutations may ask
synchronously, read paths never).

## Things that will bite you if you do not know them

- **Resolution fails closed on uncertainty only**: cannot-ask → 503,
  belongs-nowhere → token without tenant claims, refused at writes with 403.
- **`INTERNAL_SERVICE_TOKEN` lives in three `.env` files** (auth, tickets,
  organizations) and guards a mutation (the internal status PATCH). Rotation
  and audit are still not built — SECURITY.md names this the first thing to
  close before any deployment. tickets-service without it refuses every
  assignment with 503, by design.
- **The role-template mapping is written twice** (backfill script +
  `roleTemplateFromGlobalRoles`) — change both in the same commit.
- **`backfill-tenant-columns.sh` refuses to run once a second organization
  exists** (R4). Feature, not bug. It now only matters for legacy rows in
  the two nullable-by-design tables.
- **The notification dev DB had a migration checksum reconciled by hand**
  (the phase-6 migration was edited after being applied locally). Any other
  machine that applied it pre-edit will see `migrate dev` complain once;
  `migrate deploy` (CI, tests) does not validate applied checksums.
- **Adding a service still means editing `ci.yml` twice.**
- **apps/web's client-side staff boolean** still keys on `session.user.roles`
  (the response field, which survives). It drifts from server policy the day
  roles and permissions diverge for some user — the role-experience sprint
  owns replacing it with a permission-shaped session field.

## Work incomplete / deliberately deferred

- **Seeded role-template rows + the template-vocabulary/scope-qualifier
  decision** — the code map is the deliberate interim.
- **R9 beyond tickets-service**: integration suites still teardown with
  unfiltered `deleteMany()`.
- **`mv` is minted and bumped but nothing compares it** — narrowed on
  purpose to "cheap staleness signal" (ADR 0014 amendment).
- **No organization selector / token exchange**; resolution picks the oldest
  active membership.
- **`INTERNAL_SERVICE_TOKEN` stays optional in auth-service** (degrade-open
  with a boot warning): making it required would 503 the auth integration
  suite, which runs without organizations-service — revisit when the suite
  can fake the resolver at the boundary.
- Sprint 9.0 leftovers unchanged: AI usage ceilings, key rotation, rate
  limiting, `PRODUCT-ROADMAP.md`, provider-notice failure path,
  `feat/ai-service` branch deletion.

## Migrations added this session (all applied locally, dev and _test)

Phases 5–6: audit `add_organization_index`, analytics
`scope_analytics_to_organization`, notification `scope_reads_by_organization`,
users `add_directory_memberships`. Phase 7: `enforce_tenant_not_null` in
tickets, ai, analytics, notification. Phase 8: users
`drop_user_profile_roles`.

## Tests executed (2026-07-31, local)

Full gate + all nine integration suites green after phases 5–6, and again
after phases 7–8 — the second pass also proving the not-null net (a
tenantless insert violates the constraint), the queue unbind against a
pre-seeded stale binding, and that a legacy v1-typed publish is never
delivered. Backfill sequence executed and verified clean (details in the
readiness record). Remote CI: run `30642812316` green for phases 5–6; the
run for the final tip is recorded in the last docs commit.

## Services required / environment variables

Unchanged from the phases 5–6 handoff: tickets-service wants
`ORGANIZATIONS_SERVICE_URL` + `INTERNAL_SERVICE_TOKEN` or assignment answers
503; users-service consumes membership events. Every real `.env` is
git-ignored.

## Exact next action

The tenancy migration is closed. The dependency map's next stop is
**Sprint 9.5 — branches, departments, locations and stations**, which needs
its own Definition of Ready pass (it extends the organizations-service graph
and touches ticket context). Before or alongside it, two small pieces of
paid-down debt are worth their own slots: the template-vocabulary decision
(unblocks seeded role rows), and R9's shared two-tenant fixtures for the
remaining integration suites.

## Resume commands

```bash
cd C:/Proyectos/helpdesk-ai
git branch --show-current      # expect main
git log --oneline -20
git status --short             # expect clean
docker compose up -d
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Suggested continuation prompt

> Continue HelpDesk AI. The tenancy migration is COMPLETE (phases 0–8,
> Sprint 9.4, all on `main` with remote CI green): permission-based
> authorization with a required permissions set, no roles claim, NOT NULL on
> seven tenant columns (user_snapshots and audit_events nullable by design),
> v2-only publishing with self-healing queue bindings, scoped reads
> everywhere, membership lifecycle with events, fail-closed assignee
> validation. Read `docs/progress/SPRINT-009.4.md` and the handoff before
> touching anything.
>
> Next: Sprint 9.5 (branches, departments, operational stations) starting
> with its Definition of Ready — audit what the organizations-service graph
> needs, propose the schema and visibility rules, and stop for approval on
> structural decisions. Do not seed role-template rows (vocabulary question
> still open), do not remove the retiredBindingKeys literals, and do not
> "finish" the two nullable-by-design tenant columns.

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
