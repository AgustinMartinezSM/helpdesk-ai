# ADR 0023 — Creating an organization, and who owns it

Status: **Accepted** (Sprint 10.4, 2026-08-03).

## Context

Until this decision, an organization could only be created by a migration.
The bootstrap organization is seeded by
`20260730161500_bootstrap_organization`, and nothing in application code has
ever inserted an `Organization` row — the repository port declared
`findBySlug` and `findById` and no `create`.

That left a real hole, and the repository named it repeatedly:
`pilot-readiness.md` lists it twice and the handoff three times as **"the
first administrator of a fresh database has to be made in SQL"**.

The hole is a consequence of a decision I would make again. Sprint 9.10
deleted the operator endpoint that used to promote somebody, because it was
an unattributable write path — ADR 0016's rule that "an unattributable write
path kept for emergencies is the one that gets used". Deleting it was the
intended outcome. But registration lands everybody in the bootstrap holding
pen on the `requester` template, and from there the only way into a real
organization is an invitation issued from an organization that somebody
already made by hand.

So a person could register, and then there was nothing they could do.

## Decision

**An authenticated person who does not already belong to a real organization
may create one, and becomes its owner, in a single transaction.**

`POST /organizations` on organizations-service. Tenantless and keyless, the
shape `POST organizations/invitations/accept` already uses: the caller does
not belong to a real organization yet — that is the precondition, not an
oversight — so there is no tenant to require and no permission a non-member
could hold. Being the authenticated caller is the authorization, which is the
argument `PATCH /users/me` rests on.

### The creator becomes `owner`

This is the first `owner` membership the platform has ever created outside a
migration, and it deliberately does **not** go through
`canGrantRoleTemplate`.

That derivation excludes `owner` by constant precisely so that no grant path
can produce one, and it should keep doing so. This is not a grant path.
Routing through it would have meant weakening the check that makes ADR 0015's
no-platform-privilege invariant structural.

**Why this does not breach ADR 0021.** Those four rules govern _administering
an existing membership_: the requested template must be grantable by the
actor, the target's current template must be too, `owner` is refused in both
directions, and nobody administers their own row. Every one is about changing
something that already exists. Here there is nothing to change — neither the
organization nor the membership exists until the call. And an organization
created without an owner would be strictly worse: it would be this exact hole
reopened one row lower, with no attributable way to fill it.

Everything ADR 0021 governs still holds afterwards. The creator cannot later
change their own membership, cannot grant `owner` to anybody, and cannot be
targeted for one.

### Only somebody who belongs to no real organization

**This is a platform limit, not a policy**, and it is the part most likely to
be misread as timidity.

`ResolveActiveMembershipUseCase` walks a person's memberships oldest-first
and returns the first **non-bootstrap** organization, falling back to the
bootstrap one. There is no organization selector and no token exchange — ADR
0014 defers both.

So somebody who already belongs to a real organization and created a second
one would keep resolving to the first at every mint, and nothing in the
product could take them to the new one. They would own an organization they
cannot reach. Refusing is the honest shape of that limit, and the refusal
says so rather than reading as a bug.

The check is **"holds no non-bootstrap membership"**, never "holds no
membership". Registration puts everybody in the holding pen unconditionally,
so the second reading would refuse every caller that has ever registered —
which is all of them. This is the single easiest thing to get wrong here.

### The slug is derived, and a collision is never reported

The caller supplies a **name** and nothing else. The slug is derived from it,
and a collision is disambiguated silently with a short suffix.

Reporting a collision — "that name is taken" — would answer _does an
organization by this name exist?_ to anybody holding an account, across
tenants. Sprint 9.9 established that the invitation preview is the only
public place an organization's name is exposed, and this would have been a
second one with no invitation required.

**`bootstrap` is reserved, and that is provisioning-critical rather than
tidy.** The bootstrap migration inserts with `ON CONFLICT ("id") DO NOTHING`
— the conflict target is the id, not the slug — so a row already holding slug
`bootstrap` under a different id makes `prisma migrate deploy` fail on the
unique index, on every future environment. The slug column is also
case-sensitive with no `CHECK`, so the reservation is applied to the
**normalised** form or it guards nothing.

### It publishes `membership.created.v1`

users-service projects `directory_memberships` from that event. Without it
the new owner would be absent from the People screen of the organization they
were just given authority over.

No `organization.created` contract was added. Nothing consumes one — no
consumer, no promise (ADR 0022's amendment).

## What I considered and did not choose

**A documented operator script**, like the existing
`backfill-bootstrap-memberships.sh`. Smaller and safer, and it would have
replaced "made by hand in SQL" with "made by a reviewed idempotent script" —
a real improvement. It was rejected because it leaves the product unable to
onboard anybody without database access, which is the thing the brand
promises and cannot currently do.

**Allowing a second organization anyway**, and accepting that the creator
lands in the older one. Rejected: a feature whose success case is
unreachable is worse than a refusal, and the refusal is cheap to remove when
the selector lands.

**Letting the caller choose the slug.** Rejected for the enumeration reason
above. The cost is a slug somebody may find ugly; the alternative is a
cross-tenant existence oracle.

**Reusing `createIfAbsent` for the owner membership.** Rejected: its
skipDuplicates semantics exist so a replayed registration leaves an existing
row untouched, and silently doing nothing is the wrong answer for a row the
organization cannot function without. A plain create inside the transaction
lets the unique index refuse a genuine duplicate loudly.

## Consequences

**The first administrator of a fresh database no longer has to be made in
SQL.** `pilot-readiness.md` and the handoff both said so; both are corrected.
The bootstrap organization stays exactly as it is — it is migration data and
a recovery anchor, and nothing here touches it.

**This decision is coupled to a tiebreak its own author scheduled for
deletion.** `resolve-active-membership.ts` calls the real-beats-bootstrap
rule "the smallest change that makes the common case right" and says it goes
away when token exchange lands. When it does, the boundary here should be
revisited in the same change: with a selector, "you already belong somewhere"
stops being a reason to refuse.

**Renaming is still not possible**, and the screen says so rather than
promising it. The slug is derived from the name at creation, so a rename
without a slug story would leave the two disagreeing.

**`organizations` becomes a growing table.** Nothing indexes `status` today,
which was irrelevant at two rows and is worth remembering at two thousand.
