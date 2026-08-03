# ADR 0021 — Membership administration boundaries

- Status: Accepted (2026-08-02)
- Date: 2026-08-02
- Sprint: 9.10 (Member administration)

## Context

Until this sprint an organization's memberships could be changed only through
`/internal/organizations/:organizationId/memberships/*`, guarded by
`INTERNAL_SERVICE_TOKEN` — a shared process credential. Its own comment called
it an interim surface "until the people-management sprint builds the real one,
with a person's token and an audit trail behind it". Every membership change
the product could make was therefore made by nobody in particular, which is the
shape ADR 0016 forbids.

Sprint 9.8 already answered the neighbouring question for invitations:
privilege cannot travel upward, the ceiling is read from the stored membership
rather than the token, and `owner` is refused by constant because the template
map resolves it and `organization_admin` to the same permission set. Changing
an existing membership is the same problem pointed in more directions — the
target is already inside, already has a role, and may hold more than the person
acting on them.

Two decisions were also deferred to this sprint by name, in comments:
whether a deactivated membership can be reinstated (`membership.ts`), and how
suspended people appear in the directory (`user-profile.repository.ts`).

## Decision

**Membership administration is gated per act, bounded by two ceilings, and
closed against the actor themselves.**

`people.assign_roles` gates role changes; `people.suspend` gates status
changes; `branches.manage_members` gates the branch set. Three keys, not one
"manage people" key, because the matrix distinguishes them and a screen that
hides controls needs to hide them individually.

Four rules, each reading stored rows rather than token claims:

1. **The requested template must be grantable by the actor's stored template.**
   Reused from invitations: an admin cannot hand out what they do not hold.
2. **The target's current template must be grantable too.** Without this, the
   first rule alone lets an administrator demote anyone — the ceiling only
   looks at where the membership is going, never at what it currently is.
3. **`owner` is neither grantable nor targetable**, by constant. Rules 1 and 2
   are blind to it: `owner` and `organization_admin` resolve to the same
   permission set, so a subset test happily allows both minting a peer at the
   top and unseating the person at it. Two mechanisms, because one is blind.
4. **Nobody administers their own membership**, whatever they hold.

**Removal is deactivation, and deactivation is reversible.** The membership row
is never deleted — the directory projection and the audit trail are rebuilt
from it — and `deactivated → active` becomes a legal transition.

**The grant ceiling compares effective reach, not literal keys.** A small
explicit table records that `tickets.read_all` implies `tickets.read_branch`
and `tickets.read_own`, and the issuer's set is expanded through it before the
subset comparison. It is used by the ceiling only.

### Why the fourth rule is a security rule and not a courtesy

Refusing self-administration is what keeps an organization from losing its last
administrator. Because the actor can never be their own target, and must be an
active member holding the key to act at all, at least one active administrator
survives any sequence of these operations. The alternative — counting the
remaining administrators before each write — is a race against concurrent
requests and needs a lock or a constraint nobody has designed. A rule that
makes the bad state unreachable beats a check that tries to catch it.

It also makes self-demotion impossible, which is worth having on its own: it is
the one mistake on this surface with no undo, because the key you would need to
reverse it is the key you just gave away.

### Why deactivation stops being terminal

`membership.ts` made "no way back" the default for a good reason and a wrong
one. The good reason: an accidental reactivation would silently restore
access. The wrong one: it claimed "a new membership can always be created
deliberately" as the escape hatch, and `@@unique([organizationId, userId])`
means there is no second row to create. Redemption inserts with
`skipDuplicates`, so a deactivated person who accepts a fresh invitation is
told they joined and stays deactivated.

So removal was permanent, and permanent in a way nothing said out loud.

The good reason dies with this sprint rather than being overruled: the act now
requires a person's token, a permission key, a confirmation and a published
event. Nothing about it is silent. What remains is the ordinary product need to
rehire somebody, and one attributed click is the honest answer.

### What I considered

**One `people.manage` key instead of three.** Fewer keys, less matrix to keep
faithful. Rejected: the matrix already separates suspension from role
assignment, and collapsing them would grant every role-changer the power to
lock people out. It would also have to be un-collapsed the first time a
template gets one and not the other.

**Ranking the templates and comparing ranks.** A total order would make both
ceilings one comparison. Rejected for the reason ADR 0015 gave: the templates
are not ordered. A branch manager and an agent hold overlapping, incomparable
sets, and inventing a hierarchy encodes a claim the model never made.

**Granting `tickets.read_branch` to owner and admin** to fix the ceiling defect
(an admin could not invite a branch manager, because branch managers hold a key
admins deliberately do not). Rejected: it works around a wrong comparison by
making the permission map less true, and it contradicts a design statement with
a spec behind it. The implication table fixes the comparison instead, and
answers the same question again when `tickets.read_team` arrives.

**Deleting the membership row on removal.** Simplest mental model, and wrong
here: the directory's projection is rebuilt from membership events, the audit
trail is the reason the row exists, and a delete has no event to carry it.

**Keeping the internal operator endpoints as a break-glass path.** Rejected.
An unattributable write path that exists "just in case" is the one that gets
used, and ADR 0016's rule is not conditional. Operating on the database
directly is still possible for a genuine emergency, and it leaves traces the
platform did not authorize.

## Consequences

Positive:

- Every membership change in the product is attributable to a person, and the
  last request path that was not is deleted rather than deprecated.
- The last-administrator problem is closed by construction rather than by a
  query that would race.
- The grant ceiling stops giving a wrong answer for branch managers, which had
  made the retail scenario Sprint 9.5 built for impossible to onboard through
  the product.

Negative / accepted:

- **Suspension is not immediate.** The version bumps and the events publish,
  but an outstanding access token keeps working until it expires — up to
  `JWT_ACCESS_TTL_SECONDS`, 900 by default, since nothing compares `mv`. This
  is ADR 0014's accepted staleness; what changes is how many people can now
  trigger it, so it must not be described as revocation.
- **An organization can be left with exactly one administrator and no way to
  replace them from inside.** The owner's membership cannot be targeted and
  nobody may act on their own, so an organization whose only privileged member
  is its owner has no in-product path to change that role. Transfer of
  ownership is the missing operation, and refusing is its reversible half.
- **The implication table is a second place where permission relationships are
  written.** It is deliberately tiny and deliberately unreachable from
  authorization — services check literal keys — but it will need a line when a
  new scoped read key lands, and nothing will fail loudly if it does not.

## Related

ADR 0015 (the permission model, rule 1 — refusals live in use cases — and the
ordering argument this reuses), ADR 0016 (no unattributable request path, which
this closes for memberships), ADR 0013 (memberships as the source of truth,
never rebuildable), ADR 0014 (bounded claim staleness, which suspension
inherits), ADR 0019 (the public surface these routes join), ADR 0020 (the
client-side gates that render them).
