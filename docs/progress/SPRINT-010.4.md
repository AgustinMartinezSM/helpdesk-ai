# Sprint 10.4 — An organization can be created from the product

Status: **CLOSED (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 10.3 is merged and closed with remote
CI green: run `30855665981` on `19760f2`, plus its closing record on
`aa23e51`. `main` equals `origin/main` at `aa23e51`, working tree clean. The
last sprint document is `SPRINT-010.3.md`.

**This is the first domain sprint of Block B.** 10.0 through 10.3 were
strategy, tokens, identity and copy. This one changes what the platform can
do, so the invariants below are the readiness work rather than a preamble to
it.

### The gap, stated exactly

`docs/architecture/pilot-readiness.md` lists it twice and the handoff three
times: **the first administrator of a fresh database has to be made in SQL.**
That is not an oversight — Sprint 9.10 deleted the operator endpoint that used
to promote somebody, because it was an unattributable write path (ADR 0016),
and deleting it was the intended consequence. But it leaves a real hole: a
person can register, and then there is nothing they can do.

Registration lands everyone in the bootstrap organization — the migration's
holding pen — on the `requester` template. From there the only way into a real
organization is an invitation somebody else issued, which requires an
organization that somebody already made by hand.

### The mechanism that decides the scope

`ResolveActiveMembershipUseCase` walks memberships oldest-first and **returns
the first non-bootstrap organization**, falling back to the bootstrap one.
There is no organization selector and no token exchange (ADR 0014 defers
both).

That has a precise consequence, and it is the whole reason this sprint is
narrow:

- Somebody whose only membership is the bootstrap one creates an
  organization → the new membership is the first real one → **the next token
  mint lands them in it.** It works, by exactly the mechanism Sprint 9.8 added
  to make invitations work.
- Somebody who already belongs to a real organization creates a second one →
  the **older** real membership still wins → they would never land in the new
  organization, and nothing in the product could take them there.

So: **only somebody who does not yet belong to a real organization may create
one.** That is not a simplification, it is the honest boundary of what the
platform can currently express, and the refusal says so rather than pretending
the feature is coming.

### The invariants this stresses, and why each survives

**`owner` can be neither granted nor targeted (ADR 0021).** The creator
becomes the organization's `owner`, which is the first owner membership
created outside a migration. This does not breach the rule: ADR 0021 governs
_administering an existing membership_ — a grant to somebody else, or a change
to your own. Creation is a single atomic act with an attributable actor, and
an organization created without an owner would be strictly worse — it would be
the very hole this sprint exists to close, reopened one row lower.

**Nobody administers their own membership (ADR 0021).** Unchanged. The
creator's membership is created, never subsequently changed by them; every
later change still goes through the four rules, and they will still be unable
to alter their own.

**No unattributable write path (ADR 0016).** The route is authenticated. The
creator comes from the verified token, never from a body field — the same
shape `accept-invitation` uses for the addressee, and for the same reason.

**A slug collision must not be reported.** Sprint 9.9 established that the
invitation preview is the only public place an organization's name is exposed.
Answering "that name is taken" would turn organization creation into an
enumeration oracle across tenants. So the slug is **derived and disambiguated
silently**, never chosen by the caller and never refused for being taken.

**`bootstrap` is reserved.** It is a constant that anchors recovery
(`domain/organization.ts` says so), and a user-supplied name must not be able
to produce it.

### The precedent this follows

`accept-invitation.ts` is the closest existing shape and this sprint copies
it deliberately: a route on this service that is **tenantless on purpose** —
the caller does not belong yet — with **no permission key**, because being the
authenticated caller is the authorization. Its comment already generalises the
pattern from `PATCH /users/me`: "being yourself is enough".

## What this sprint is, and is not

**In scope:** creating an organization from the product, the creator becoming
its owner, the refusals above, the events the existing contracts already
carry, a screen for somebody who belongs nowhere, an ADR for the decision, and
tests at the unit, controller and integration levels.

**Out of scope, and deliberately:** an organization selector or token exchange
(ADR 0014 defers them, and this sprint's boundary exists _because_ they are
deferred); transfer of ownership; renaming an organization; changing a slug;
deleting or suspending one from the product; email; and every Block A item.
**No new event contract** unless a consumer needs one — no consumer, no
promise (ADR 0022).

## Definition of Done

- A person who has just registered can create an organization and, at their
  next session refresh, be acting inside it as its owner.
- A person who already belongs to a real organization is refused, in a message
  that says why rather than implying a bug.
- The slug is derived, unique, never caller-supplied, never reported as taken,
  and can never be `bootstrap`.
- Nothing about ADR 0021's four rules changes, and a test says so.
- The refusal paths are covered at the HTTP boundary, not only below it —
  the lesson Sprint 9.13 paid for.
- `product-status.ts` moves only if the capability genuinely moved, and ADR
  0009's status vocabulary decides which way.
- The full gate passes plus the organizations integration suite, commits are
  focused Conventional Commits, merge to `main` is `--ff-only`, remote CI
  green on the final HEAD, working tree clean, and `CURRENT-HANDOFF.md` names
  the next exact action.

## Outcome

The hole is closed: a person can register, create an organization, and be its
owner, without anybody touching a database.

### What was built

`POST /organizations` on organizations-service — tenantless and keyless, the
shape `POST organizations/invitations/accept` already uses — through the BFF's
`POST /organization`, behind a screen at `/organization/new` that follows
`/join`'s shape including the session refresh it had to learn in 9.9.

`CreateOrganizationUseCase` writes the organization and its owner membership
through one repository method that owns a transaction, then publishes
`membership.created.v1` so users-service projects the new owner into the
directory. No `organization.created` contract was added: nothing consumes one
(ADR 0022's "no consumer, no promise").

The decision and everything it rests on is **ADR 0023**.

### The three things most likely to have gone wrong, and what the repository

### said about each

**The membership check.** `EnsureMembershipUseCase` writes a bootstrap
membership on every registration, unconditionally. So "may create if they
belong nowhere" had to be implemented as **"holds no non-bootstrap
membership"** — the other reading would have refused every caller that has
ever registered, which is all of them. The reconnaissance flagged this as the
single most likely place to get the sprint wrong, and it was right to.

**The reserved slug.** The bootstrap migration inserts with
`ON CONFLICT ("id") DO NOTHING` — the conflict target is the **id**, not the
slug. So an organization that took slug `bootstrap` would not merely be
confusing: it would make `prisma migrate deploy` fail on the unique index on
every future environment. And because the slug column is case-sensitive with
no `CHECK`, the reservation has to be applied to the **normalised** form or it
guards nothing. Both are tested.

**`owner` outside a migration.** `ORGANIZATION_GRANTABLE_TEMPLATES` excludes
it by constant so that no grant path can produce one, which means this had to
be a genuinely new write path with no shared validation to lean on. That is
the right outcome rather than a gap — routing it through
`canGrantRoleTemplate` would have meant weakening the check that makes ADR
0015's invariant structural. The reasoning for why this is not a breach of
ADR 0021 is in ADR 0023 rather than in a comment.

### One claim I wrote and had to take back

The first version of the screen said **"You can change the name later."** It
cannot: renaming an organization is not built, the slug is derived from the
name at creation, and `pilot-readiness.md` records the immutability as its own
decision. I caught it while re-reading the copy against the claim rules this
block spent three sprints establishing, and it is a good demonstration of why
those rules are worth having — the sentence is exactly the comfortable thing a
person writes without checking. It now says the opposite, and so does Helpi's
hint for the route.

### Verification

Full gate green: format, lint, typecheck across 15 projects, **376 unit tests**
(354 in organizations-service, up 22), and build.

Three levels, deliberately:

- **Unit**, with fakes that honour both unique indexes for real — a fake that
  accepted a duplicate slug would let a use case with a missing check pass.
- **HTTP**, eleven cases through the real guard, the real validation pipe and
  the real error filter: the 409 for somebody already placed, 400 for a body
  that names a creator or a slug, 401 unauthenticated, and the route reached
  with no tenant claim at all. This level exists because of the lesson 9.13
  paid for.
- **Integration**, against real PostgreSQL: both rows committing together, and
  — the one that matters — **nothing left behind when the second insert
  fails**. Without the transaction that would be an organization nobody can
  administer, permanently, because there is no outbox to repair it with.

**The integration suite was not run locally and I want that stated plainly.**
Docker is not running on this machine, so `docker compose up` fails and the
suite cannot start. It runs on CI, which provisions a throwaway database per
integration target, so its first real execution is the CI run recorded above
rather than a local one. Every other level ran here.

### What this leaves open

**Somebody who already belongs to a real organization still cannot create a
second one**, and the refusal says so. That is not a stub: it is the honest
boundary of a platform with no organization selector, and ADR 0023 records
that the boundary should be revisited in the same change that adds token
exchange — with a selector, "you already belong somewhere" stops being a
reason to refuse.

**Renaming an organization is still impossible**, and now three surfaces say
so rather than one.

**`organizations` becomes a growing table** for the first time, and nothing
indexes `status`. Irrelevant at two rows; worth remembering.

### Documentation

- **ADR 0023** — new: the decision, the four alternatives rejected, and the
  consequences.
- **`pilot-readiness.md`** — the "first administrator made in SQL" item is
  struck through and says what closed it and what remains; its second mention
  in the CSV-import residual is corrected too.
- **`product-status.ts`** — "Creating your organization" is a new `available`
  capability with a note stating the limit; the stale Planned item saying the
  first administrator is created by hand is gone.
- **`CURRENT-HANDOFF.md`** — Sprint 10.4's entry and the next exact action.

No fictional experience, customer, testimonial, incident, external approval or
commercial adoption was introduced.
