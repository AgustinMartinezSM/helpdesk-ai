# ADR 0024 — Ownership is a row, and it moves in one transaction

Status: **Accepted** (Sprint 10.5, 2026-08-04).

Extends **ADR 0023** (creating an organization) and sits beside **ADR 0021**
(membership administration boundaries), which it deliberately does not amend.

## Context

ADR 0023 gave the platform its first `owner` membership outside a migration:
whoever creates an organization becomes its owner, in the transaction that
creates the organization. It said nothing about what happens afterwards,
because at the time nothing could.

Nothing could, and that was a real hole rather than a gap in the writing. ADR
0021 makes an `owner` membership untouchable in both directions — it is
excluded from the grantable set by constant, and a member carrying it fails the
target ceiling — so from inside the product:

- nobody could be made an owner;
- the existing owner could not be demoted, suspended or removed;
- and the organization's owner was therefore whoever registered it, for as long
  as the organization existed.

The failure mode is ordinary rather than exotic. Somebody sets up the
organization, invites their colleagues, and leaves the company. The
organization now has an owner nobody can reach and no path to a new one that
does not go through a database console — which is precisely the thing ADR 0023
existed to remove.

The organization's display name had a smaller version of the same problem: it
was chosen once, at creation, and three surfaces said out loud that it could
never change.

## Decision

**Ownership is a stored row, exactly one per organization, and it moves between
two rows of that organization in a single transaction. The organization's
display name can change; its slug cannot.**

### The authorization is the row, not a permission key

Only the current owner may transfer ownership, and "current owner" is decided
by reading the actor's **stored membership** — not their token, and not a
permission key.

There is no `organization.transfer_ownership` key and there should not be one:

- The approved matrix in `tenancy-target-state.md` has no such row.
  `permissions.ts` states in its own header that only keys with a real
  server-side call site exist, because an unchecked key in a token is a claim
  nothing can falsify — and inventing vocabulary the matrix does not have is
  the same problem from the other end.
- It would have to be granted to `owner` alone, which means splitting `owner`
  from `organization_admin` in the permission map. Those two resolve to the
  same set today, three files reason from that premise, and two tests pin it.
  That is a large change to express something a single column already says.
- **It would be the weaker copy.** An access token lives
  `JWT_ACCESS_TTL_SECONDS` (900) and nothing compares `mv`, so a person who
  handed the organization over a minute ago still carries claims that say
  owner. Every other consequence of that staleness is a fifteen-minute
  annoyance; here it would let them take the organization back from the person
  they just gave it to. The check has to read the row regardless, so a key
  beside it would only be a second answer that can disagree.

Renaming is different and reuses the existing `organization.update`. The matrix
grants that key to owner and admin exactly, its first call site is
users-service's profile-field definitions, and the organization's own display
name is what the key is named after. A rename grants nothing to anybody and the
next administrator can undo it, so it follows the shape every other
organization-setup write uses: the key from the token, checked in the use case
(ADR 0015 rule 1).

### Why this is not a grant, and must never become one

`ORGANIZATION_GRANTABLE_TEMPLATES` excludes `owner` by constant so that no
grant path can produce one. ADR 0023 kept creation outside that derivation for
the same reason, and a transfer stays outside it too.

The distinction is not a technicality. A grant hands a template **out of the
grantable set** to somebody while the granter keeps what they had; the count of
holders goes up. A transfer moves a single `owner` between two rows of one
organization and leaves the count exactly where it was. Routing it through
`canGrantRoleTemplate` would mean widening the set so the operation fits, which
would turn ADR 0015's no-platform-privilege invariant back into an accident of
a list that happens to be short.

### Why this does not breach "nobody administers their own membership"

ADR 0021's fourth rule refuses an actor who targets their own row, and the
reason is specific: it is what keeps an organization from losing its last
administrator. The actor must hold the key and be active to act at all, and can
never be the target, so at least one privileged member survives any sequence of
those operations. A counting check would race concurrent requests; making the
bad state unreachable does not.

A transfer changes the actor's own row — it demotes them — and the invariant
still holds, **by construction rather than by exception**. The transaction
writes exactly one `owner` and one `organization_admin`, so an organization
ends a transfer with at least as many privileged members as it started with,
never fewer. The failure mode rule 4 exists to prevent is unreachable here.

Everything ADR 0021 governs still holds afterwards, and it follows the row
rather than the person: the new owner is the one nobody can demote or suspend,
and the previous owner becomes ordinarily administrable again.

### The previous owner becomes `organization_admin`

Not removed, and not left as `owner` beside the new one.

`organization_admin` is the answer because it is the only template that keeps
every permission they were exercising a moment earlier — owner and admin
resolve to the same set — so nothing they had open stops working mid-session,
and the organization does not silently lose an administrator because somebody
handed the top of it on. Removing them instead would make a transfer a
combination of two decisions where the person only made one.

### Exactly one owner, enforced by the database

A partial unique index: `(organization_id) WHERE role_template = 'owner'`.

The transaction and its conditional updates are the mechanism, and they are
correct. The index is what makes "two owners" **unrepresentable** rather than
merely unlikely, so a future write path that forgets the conditions fails
loudly instead of quietly producing an organization with two people at the top
of it. It is additive and true of every existing row: the bootstrap
organization is seeded with no owner, and every organization created since ADR
0023 was created with exactly one.

It is deliberately **not** filtered on status, because an `owner` membership
cannot be suspended or removed through any surface — ADR 0021 refuses to
administer a member carrying it, in both directions — so "the owner row" and
"the active owner row" are the same row. A status predicate would let a second
owner exist the moment that stopped being true.

The index also decides the statement order inside the transaction. A unique
index is checked per statement, not deferred to commit, so **the demotion runs
first**. Promoting first would make the transaction fail against its own index
every time.

### Concurrency, stated precisely

Both writes are conditional `updateMany` calls, the shape
`PrismaInvitationRepository.redeem` established for single-use codes.

The demotion carries the whole argument: `role_template = 'owner'` in the WHERE
clause is what serializes two transfers of the same organization. The second
transaction blocks on that row's lock, re-reads it after the first commits, no
longer matches, and reports zero rows — so the loser changes nothing and its
caller answers 409. The promotion re-checks `status = 'active'`, because
somebody holding `people.suspend` could have suspended the receiver between the
use case's read and this write.

Either condition failing throws inside the transaction, which rolls the other
back. A failed transfer leaves the original ownership exactly as it was; there
is no state in which an organization has no owner.

### The slug does not move with the name

The display name is editable. The slug is derived from the name at creation and
is fixed forever.

They are different things, and the branch surface already models the same split
one level down: a branch's `code` is immutable and its `name` is not. Here the
argument is stronger, because the slug is what the bootstrap lookup keys on,
what `prisma migrate deploy` collides with if `bootstrap` is ever taken (ADR
0023), and what ADR 0023 derived **silently** so that a collision could never be
reported across tenants. Recomputing it from a new name would either reopen that
existence oracle or leave the two disagreeing about which organization a URL
means.

So the port's `rename` takes a name and has no slug parameter at all. That is
not the caller being careful; it is the shape making the careless version
unwritable.

Editing the slug by hand is out of scope and stays out of scope until something
needs it. It would need a redirect story, a uniqueness answer that does not leak
across tenants, and a migration for whatever ends up pointing at it.

### Both operations publish, and the audit trail is why

`organization.renamed.v1` and `organization.ownership-transferred.v1`. Their
only consumer is the audit firehose, which is a sufficient standing — the same
`people.import.completed.v1` has had since Sprint 9.15.

They are not redundant with the membership events. A transfer publishes
`membership.role-changed.v1` for both rows, because that is what keeps
users-service's directory projection correct; but those events name the rows
that moved and never the person who moved them. Two rows changing template in
one transaction says an administrator did some administration. Only the
ownership event says the organization changed hands, and by whose decision.

Payloads carry ids, templates and — for the rename — the organization's own
display names. No addresses, no personal names, nothing about either person
beyond their id. Audit binds `#` and keeps payloads opaquely and indefinitely,
and these are events the trail keeps for as long as the organization exists.
`audit-service` learned that `organization.*` is born tenant-carrying, so one
of these arriving without its tenant dead-letters rather than recording a row
that explains nothing.

## What I considered and did not choose

**A new permission key.** Covered above. It is the option a reader will reach
for first, and the reason it loses is that it duplicates a fact the row already
states while being the staler of the two copies.

**Making `owner` grantable and reusing the role-change endpoint.** Much less
code: an owner promotes somebody to owner, then demotes themselves. Rejected
twice over. It would widen the constant that makes ADR 0015's invariant
structural, and it would make the operation two requests — so an organization
with two owners, or none, would be an ordinary outcome of somebody closing a
laptop between them.

**Two separate updates without a transaction.** Rejected for the same reason
ADR 0023 rejected a split write on creation: there is no outbox (ADR 0006), so
a failure between the two is unrecoverable by anything except a person with
database access, which is the thing this whole block of work exists to stop
requiring.

**A "count the owners" check before writing.** This is the shape ADR 0021
already rejected for administrators, and it fails here for the same reason: it
races. Two concurrent transfers can both count one owner and both proceed. The
conditional update does not race, and the index would refuse the result even if
it did.

**Removing the previous owner instead of demoting them.** Rejected: it turns
one decision into two, and the second one — "and also remove them from the
organization" — is a decision the person handing over never made. Demotion is
also reversible by the new owner; removal is a separate act with its own key.

**Recomputing the slug on rename.** Rejected above. Cheap to write, and it
reopens a cross-tenant existence oracle ADR 0023 spent a decision closing.

## Consequences

**An organization is now fully self-serve for a single tenant.** Somebody can
register, create an organization, name it, invite colleagues, rename it and
hand it on, without anybody touching a database. That was the point of Block
B's domain work, and it is complete for one organization per person.

**`organization.read` has its first call site.** It has existed since the
permission migration and is granted by every template, but nothing checked it
until `GET /organizations/current`. Worth knowing that the key stopped being
decorative in this sprint.

**`viewerIsOwner` is a new kind of client signal, and it is deliberate.** ADR
0020 says the browser decides what to render from what the server tells it. It
does not say that signal has to be a permission — and here it must not be,
because permissions cannot distinguish an owner from an administrator. Read
fresh per request, it is also strictly less stale than the snapshot beside it.

**Amendment — Sprint 10.6.** The deferral below is closed by ADR 0025, and
everything this record decides survives it unchanged: ownership rules apply
**per organization**, exactly as written. One person may now own two
organizations, which the partial unique index already permits because it is
scoped per `organization_id` — an index written one column narrower would have
refused it, and an integration test now proves it does not. The transfer still
reads the actor's stored membership rather than their token, which matters more
now that a token's organization is mobile.

**Second-organization creation stays deferred, unchanged.** ADR 0023 refuses it
because `ResolveActiveMembershipUseCase` picks the oldest non-bootstrap
membership at every mint and there is no selector, so a second organization
would be one its own creator could never reach. Nothing here changes that, and
the two should be revisited together: **token exchange and organization
selection have to solve which organization a person is acting in, how they
change it, and how a token is re-minted for the new one** — and when they do,
"you already belong somewhere" stops being a reason to refuse a second
organization, while the ownership rules in this record keep applying per
organization exactly as written.

**Nothing here deletes or suspends an organization.** The `owner` template
carries `organization.delete` in the matrix and no call site exists. Deleting a
tenant is a data-retention decision before it is an endpoint.

**`memberships` gained an index that every membership write now maintains.**
Irrelevant at the current scale, and worth remembering beside ADR 0023's note
that `organizations` has become a growing table with nothing indexing `status`.
