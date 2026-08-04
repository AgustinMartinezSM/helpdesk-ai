# Sprint 10.6 — Choosing which organization you are in

Status: **OPEN (2026-08-04).** The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 10.5 is merged and closed with remote
CI green: run `30863440095` on `dbd5837`, plus its closing record — run
`30863653031` on `79eb381`. `main` equals `origin/main` at `79eb381`, working
tree clean. The last sprint document is `SPRINT-010.5.md`.

**This is the sprint every deferral has been pointing at.** ADR 0014 named it
and did not build it; ADR 0023 and ADR 0024 each parked a limit here by name.
It is the largest remaining Block B item.

### What ADR 0014 already decided, and what it left

The design is not open. ADR 0014 settled it in Sprint 9.1 and the code has been
waiting for it:

> **Switching organizations mints a new token.** auth-service validates the
> requested organization against an active membership at mint time and refuses
> otherwise. There is no "switch" that a client performs on its own; it is a
> token exchange, so the server decides.

and, in the same record:

> **Not built:** the token exchange. […] Nothing in the platform can select an
> organization today, because there is only one.

So this sprint does not choose a mechanism. It builds the one already chosen,
and answers the two questions ADR 0014 left open underneath it: **where a
choice is remembered between requests**, and **what happens when a remembered
choice stops being valid**.

Two more constraints come from the same record and are not reopened here:

- **A session belongs to a person, not to a workspace.** `refresh_tokens` keeps
  its user-only key. ADR 0014 settled this during Sprint 9.2 implementation and
  gave the reason: reuse detection revokes every session a person has, and a
  per-organization session would force that revocation to decide whether a
  token stolen from one workspace should kill the others.
- **No service ever reads tenancy from a header.** The gateway is
  `http-proxy-middleware` with no policy layer, so a header would be an
  attacker-controlled string reaching the one place that decides access.

### The decisions this sprint makes, with the alternative each beat

**Switching mints an access token and does NOT rotate the session.** The
exchange presents the caller's own access token, is guarded by
`JwtAccessGuard`, and returns a new access token for the requested
organization. The refresh family is untouched, which means the shared-terminal
born-window derivation (Sprint 9.7) and reuse detection are untouched too —
switching context is not starting a session, and a design where it rotated the
refresh credential would have made every switch a new session for machinery
that deliberately keys sessions to people.

**Where the choice is remembered: an httpOnly cookie held by the BFF, not a
column on `refresh_tokens`.** The column is the obvious alternative and it is
the one I rejected. ADR 0014 explicitly settled that `refresh_tokens` gains no
column; reopening that settlement in the very sprint that finally implements
the rest of the record is how a decision record stops being trustworthy. The
cookie also costs no migration and no persistence change in the service that
mints tokens.

What makes the cookie safe is that **it only asks**. Every mint validates the
requested organization against the caller's stored membership and refuses or
falls back; a tampered cookie can request something and be told no. This is
categorically different from the `x-organization-id` header ADR 0014 rejected,
where a downstream service would have _trusted_ the value — here the value
reaches exactly one place, and that place checks it against the database before
signing anything.

The cost, stated: the choice is browser state, so a second device starts from
the default rule. A non-browser client passes `organizationId` explicitly
instead, which is what an API client would do anyway.

**A fresh sign-in starts from the default rule, and login clears the cookie.**
The alternative — login honouring a remembered choice — makes a credential
exchange depend on browser state. The mixed version is worse than either: if
login ignored the cookie but refresh honoured it, a person would land in one
organization and be moved to another seconds later. Clearing is deterministic
and has no flicker.

**A choice that can no longer be honoured falls back; it never refuses.** A
person removed from the organization their cookie names must not be signed out
of the product. Resolution answers "not that one" — which is an answer, not the
uncertainty that `TenantContextUnavailableError` exists for — so the refresh
falls back to the default rule and the BFF rewrites the cookie to whatever came
back. Treating it as a 401 or 503 would silently sign somebody out of a
perfectly valid session, because `AuthProvider` turns any failed refresh into
`anonymous`.

**The 9.8 real-beats-bootstrap tiebreak STAYS, and the code comment that
schedules its deletion is wrong.** `resolve-active-membership.ts` says "this
tiebreak goes away with it". It cannot. The tiebreak is the rule that runs when
nothing has been requested, and something must run then — every login does,
forever, and a person signing in on a new device has expressed no choice.
Deleting it would regress every invited account, not just multi-organization
ones: registration writes a bootstrap membership unconditionally and it is
almost always the oldest, so oldest-first alone hands invitees the migration's
holding pen. The comment is corrected rather than obeyed, and the tiebreak is
promoted from "the smallest change that makes the common case right" to **the
documented default when no organization is requested**.

**ADR 0023's refusal of a second organization is lifted.** Its own
justification is conditional — the creator "would own an organization they
cannot reach" — and after this sprint they can reach it. Both ADR 0023 and ADR
0024 defer here by name. **Lifting the refusal is not a deletion**: the create
flow has to switch into the new organization, or the sprint ships exactly the
stranded organization the refusal existed to prevent, with nothing left to
catch it.

**The organization listing lives on organizations-service's public surface,
not behind auth-service.** `GET /organizations/mine`, authenticated, keyless
and tenantless — the shape `GET /organizations/teams/mine` already uses, and
for the same reason: the people who need it hold no key that would gate it, and
it returns nothing the caller's own memberships do not already contain. Putting
it behind auth-service would mean a new internal endpoint, a credential hop and
a second path to data that service already publishes.

### The invariants this stresses, and how each is met

| Invariant                                               | How                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Nobody reaches an organization they do not belong to    | Every mint resolves against the stored membership; the requested id is a request, never a fact                 |
| A tampered cookie grants nothing                        | It is validated at the one place that signs; refusal and fallback are the only outcomes                        |
| No service reads tenancy from a header                  | Unchanged — the choice reaches auth-service in a body, and travels onward only as a claim                      |
| `org`, `perms`, `mv`, `br` and `tm` always agree        | One resolution builds all five from one membership row; a second mint path must never assemble them separately |
| A suspended membership or organization is not reachable | `grantsAccess` plus `isActive`, on the requested path exactly as on the default path                           |
| A session still belongs to a person                     | The exchange does not touch `refresh_tokens`; reuse detection and the born window are untouched                |
| Removal does not sign somebody out                      | Unhonourable choice falls back to the default rule and rewrites the cookie                                     |
| Existing single-organization behaviour is unchanged     | With no requested organization, resolution runs exactly today's algorithm                                      |

### The defect this sprint's reconnaissance found first

Reading `session.service.ts` and `jwt-token-issuer.ts` — the two files this
sprint edits — turned up a live defect: **`SessionService` has assembled a `tm`
claim since Sprint 9.12 and the issuer never copied it**, because
`AccessTokenClaims` did not declare one. `tickets.read_team` denies on an
absent claim, so it has granted nothing in production for four sprints.

It is fixed in its own commit _before_ this sprint's work, because it changes
team-scoped visibility for every `service_desk_manager` at once and the sprint
must not appear to have caused that. Two things made it invisible and both are
worth carrying: `...(condition && { tm })` is a spread, so excess-property
checking never fires and TypeScript cannot see the missing field; and the
mint-path tests assert what the fake issuer was **handed** rather than what was
**signed**. The regression test decodes a real token.

## What this sprint is, and is not

**In scope:** the token exchange; an optional requested organization on
refresh; the organization listing; the BFF cookie and its lifecycle; a
switcher in the app shell; lifting the second-organization refusal and taking
the creator into what they just created; per-organization state reset in the
browser; an ADR; and tests at every level including real PostgreSQL and a
tenant-isolation case.

**Out of scope, and deliberately:**

- **Rekeying analytics' `user_snapshots` on `(userId, organizationId)`.** It is
  keyed on `userId` alone and is already wrong today — the bootstrap membership
  claims the row first — so every organization already counts approximately
  nobody. It is a live defect this sprint makes easier to notice and did not
  cause; fixing it needs a migration, a backfill and a correction to an
  in-memory double that disagrees with Prisma about the behaviour being
  changed. Recorded, not fixed, and 10.6 is not blamed for it.
- **Making `INTERNAL_SERVICE_TOKEN` required in auth-service.** Its env comment
  says it becomes required "in the phase that makes the claims decide
  something", and this looks like that phase. But the auth integration suite
  runs without organizations-service, so flipping it turns every login in that
  suite into a 503. The order is: teach the suite to override the resolver at
  the boundary, then flip it, in a sprint that owns the suite change.
- **Comparing `mv` anywhere.** Nothing reads it, and branch and team membership
  changes do not bump it — making it load-bearing while `org` becomes mobile
  would validate two claims and silently pass three stale ones, which reads as
  a complete guarantee and is not.
- **Revoking the outgoing access token on a switch.** There is no revocation
  list and building one is a platform-wide change. For up to
  `JWT_ACCESS_TTL_SECONDS` a person holds two valid tokens naming two
  organizations. This is the staleness ADR 0014 already accepts, but its
  argument is about membership _changes_ rather than a deliberate context
  change, so the ADR says so in its own words rather than inheriting it
  silently.
- Cross-organization ticket or people views; merging directories; per-
  organization station context; any surface that answers which organizations
  exist beyond the caller's own.

## Definition of Done

- A person who belongs to two organizations can see both, choose one, and have
  every subsequent request act in it — with `org`, `perms`, `mv`, `br` and `tm`
  all re-resolved together for that organization.
- Requesting an organization the caller does not actively belong to is refused,
  and the refusal does not distinguish "not yours" from "does not exist".
- A remembered choice that stops being valid falls back silently and rewrites
  itself; nobody is signed out by it.
- Login starts from the default rule, and the 9.8 tiebreak still decides it.
- A person who already belongs to an organization can create a second one and
  lands inside it.
- Nothing about single-organization behaviour changes, and tests say so.
- Every refusal is covered at the HTTP boundary as well as below it.
- `product-status.ts` moves only as far as the code moved, and the claim that
  the product cannot move a person between organizations is corrected.
- Full gate, focused Conventional Commits, `--ff-only` to `main`, remote CI
  green on the final HEAD, clean tree, and `CURRENT-HANDOFF.md` naming the next
  exact action.

## Outcome

_Written at the close of the sprint._
