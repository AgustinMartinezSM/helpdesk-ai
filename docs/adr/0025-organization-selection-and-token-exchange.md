# ADR 0025 — Choosing an organization, and the token exchange that does it

Status: **Accepted** (Sprint 10.6, 2026-08-04).

Implements the half of **ADR 0014** that was recorded as _"Not built"_, and
retires the limits **ADR 0023** and **ADR 0024** each deferred here by name.

## Context

ADR 0014 decided in Sprint 9.1 how the active organization travels — inside the
signed access token — and how it would be chosen:

> **Switching organizations mints a new token.** auth-service validates the
> requested organization against an active membership at mint time and refuses
> otherwise. There is no "switch" that a client performs on its own; it is a
> token exchange, so the server decides.

and then, in its own words:

> **Not built:** the token exchange. This ADR describes switching organizations
> as a mint with a validated request, and there is no endpoint for it. Nothing
> in the platform can select an organization today, because there is only one.

Five sprints later "there is only one" had stopped being true, and three
deferrals had accumulated against this one:

- `ResolveActiveMembershipUseCase` picks the oldest non-bootstrap membership at
  every mint, with the Sprint 9.8 tiebreak preferring a real organization over
  the holding pen. Nobody can express a preference.
- ADR 0023 refuses a second organization, explicitly because its creator "would
  own an organization they cannot reach", and says to revisit that "in the same
  change that adds token exchange".
- ADR 0024 says its ownership rules "keep applying per organization exactly as
  written" once a person can belong to more than one.

So the mechanism was not open. What was open were the two questions underneath
it, which ADR 0014 never had to answer because nothing could choose: **where a
choice is remembered between requests**, and **what happens when a remembered
choice stops being valid**.

## Decision

**Switching is a token exchange on the caller's own access token, and the
choice is remembered by the browser in an httpOnly cookie that only asks.**

### The exchange mints an access token and does not touch the session

`POST /auth/session/organization`, guarded by `JwtAccessGuard`, body
`{ organizationId }`. The caller is `sub` from the verified token — a body
field naming a user would let anybody holding an account mint a token for
somebody else. It returns the session shape **minus** the refresh credential.

Nothing here writes to `refresh_tokens`, and that is the shape of the decision
rather than an optimisation. ADR 0014 settled during Sprint 9.2 that **a
session belongs to a person, not to a workspace**, and reuse detection revokes
every session that person has. Switching context is not starting a session, so:

- the shared-terminal born-window derivation (Sprint 9.7) is untouched — a
  session opened on a till cannot be lengthened by choosing an organization;
- reuse detection is untouched;
- and the row still describes a person, so nothing in auth-service had to learn
  what a workspace is.

### The organization is a request, validated at the one place that signs

`ResolveActiveMembershipUseCase` gained an optional requested id. It is honoured
only if the person holds an **active** membership in an **active** organization
by that id — the same two gates the default walk applies, in the same order, so
asking for something by name cannot reach what the walk would skip.

This is why an id that came from a browser is safe here and would not be safe in
a header. ADR 0014 rejected `x-organization-id` because the gateway is
`http-proxy-middleware` with no policy layer, so a downstream service would have
been _trusting_ an attacker-controlled string. Here the value reaches exactly one
place, and that place asks the database before signing anything. The difference
is not the transport; it is whether anything validates.

**An unhonourable request answers `null`, the same as belonging nowhere.** The
port says what a token could assert, not why it could not. Its two callers do
different things with that, and the difference is the interesting part:

- **The exchange refuses.** Somebody who explicitly asked to go somewhere must
  be told they cannot, not quietly left where they were and shown a screen that
  says otherwise. It is a 404, blind to which kind of no it is: distinguishing
  "not yours" from "no such organization" would make the endpoint an oracle for
  what exists, which is the cross-tenant leak ADR 0023 spent a decision closing
  for names and slugs.
- **A refresh falls back.** Somebody removed from the organization their client
  remembers must not be signed out of the product. "Not that one" is an answer,
  not the uncertainty `TenantContextUnavailableError` exists for — the service
  was reached and it replied. The refresh mints for the default rule instead,
  and the client discovers the substitution by reading `organizationId` off the
  session, which is exactly what it needs in order to stop asking.

### The choice lives in an httpOnly cookie, not a column

The obvious alternative is a column on `refresh_tokens`, carried forward on
rotation the way the born window already is. I rejected it.

ADR 0014 **explicitly settled** that `refresh_tokens` keeps its user-only key
and gains no column, and gave a reason that still holds. Reopening that
settlement in the very sprint that finally implements the rest of that record is
how a decision record stops being trustworthy. The distinction I could have
drawn — that recording _where a session last was_ is not the same as making the
session belong to a workspace — is real, but it is a nuance a future reader
would have to reconstruct from a paragraph, against a sentence they can quote.

What makes the cookie safe is that **it only asks**. Every mint validates it and
refuses or falls back; a tampered value can request something and be told no.
It is httpOnly and scoped to `/session` beside the refresh credential anyway,
because page scripts have no reason to read it and the only requests that need
it are the ones that mint.

The cost, stated rather than hidden: **the choice is browser state, so a second
device starts from the default rule.** A non-browser client passes
`organizationId` explicitly instead, which is what an API client would do.

Three lifecycle rules follow, each with a reason:

- **The BFF records what was MINTED, not what was asked for**, and only after
  the server agreed. Writing it first would leave a browser asking for something
  it had just been refused, on every refresh.
- **A refresh rewrites it** to whatever came back. That is how a stale choice
  corrects itself.
- **Login clears it.** A fresh sign-in starts from the default rule. Honouring a
  remembered choice would make a credential exchange depend on browser state,
  and the mixed version is worse than either: ignoring it at login while
  honouring it at the next refresh would land somebody in one organization and
  move them seconds later.

### The Sprint 9.8 tiebreak stays, and the comment scheduling its deletion was wrong

`resolve-active-membership.ts` said the real-beats-bootstrap tiebreak "goes away
with" the token exchange. It cannot, and the comment is corrected rather than
obeyed.

A selector adds a way to ask. Something still has to answer when nobody has
asked — and that is **every login, forever**, because a person signing in has
expressed no choice and the cookie is deliberately cleared at that moment.
Deleting the tiebreak would not merely affect multi-organization accounts: the
registration consumer writes a bootstrap membership unconditionally and it is
almost always the oldest, so oldest-first alone would hand every invited account
the migration's holding pen. It is promoted from "the smallest change that makes
the common case right" to **the documented default when no organization is
requested**, and it stays a tiebreak rather than a filter so that an account
whose only membership is the bootstrap one still resolves to it.

### The listing is on organizations-service, and excludes the holding pen

`GET /organizations/mine`, authenticated, **keyless and tenantless** — the shape
`GET /organizations/teams/mine` established. Keyless because the key would have
to be one every template holds, which is not a key; tenantless because requiring
one would break it in the state it exists for, namely somebody with no
organization or somebody trying to leave the one their token names.

It is the platform's first deliberately cross-tenant read. Every other read is
scoped by one `actor.organizationId`; this one is scoped by **the caller's own
membership set**, which is why that scoping is stated in the use case rather
than assumed. It reopens no existence oracle: every name it returns is one the
caller could already read from an organization they belong to.

It lives on organizations-service rather than behind auth-service because that
service owns memberships and already has a public face (ADR 0019). Routing it
through auth-service would have meant a new internal endpoint and a credential
hop for data reachable with the caller's own token.

**The bootstrap organization is excluded from the listing.** It is migration
data and a recovery anchor, not a workspace anybody chooses. An account whose
only membership is the bootstrap one gets an empty list, which is the truth —
they have nothing to choose between — while their session still resolves there
through the default rule. **This is a listing rule and must never be applied to
the resolver**: doing so would lock every legacy account out of the product.

### ADR 0023's refusal of a second organization is lifted

Its justification was conditional and its condition is gone. **Lifting it is not
a deletion**: the create flow now exchanges into the organization it just made,
because a plain refresh re-runs the default rule and returns the _oldest_
organization — so for anybody who already belonged somewhere, the new one would
be invisible and its creator would own something they never arrive at. That is
precisely the stranded organization the refusal existed to prevent, and with the
refusal gone there is nothing left to catch it. A web spec pins the exchange.

## What I considered and did not choose

**A column on `refresh_tokens`.** Covered above. It is the option a reader
reaches for first, and it loses on a documentation property rather than a
technical one — which is worth saying plainly, because the technical case for it
is decent and the case against is that ADR 0014 already answered it.

**Rotating the refresh token on every switch.** Would have made switching a
session-level act, dragging the born window and reuse detection into a path that
has nothing to do with either, and would have made a burst of switches look like
a burst of new sessions.

**A `orgs` claim listing every organization in the token.** Rejected: tokens
grow, ADR 0014 already flags `perms` as the field to watch there, and it would
make the whole platform pay on every request to answer what one screen asks
once.

**Refusing rather than falling back on a stale choice.** The tempting symmetry
with the exchange. Rejected because `AuthProvider` turns any failed refresh into
`anonymous`, so it would silently sign somebody out of a valid session because a
membership changed — and 503-on-uncertainty is a habit that makes this mistake
easy to reach for.

**Login honouring the remembered choice.** Nicer on the second morning, and it
makes a credential exchange depend on browser state. The deciding argument is
the mixed version's flicker; between the two coherent options, the deterministic
one wins.

## Consequences

**A person can belong to more than one organization and work in each of them.**
Each keeps its own role, branches and support teams; nothing is shared, and
every mint re-resolves all five claims together from one membership row.

**Claims are assembled in exactly one place**, reached by both mint paths. This
was already true by accident — one loop iteration built them — and is now true
by construction, because a second assembly site is how a token would come to
name one tenant's organization and another's permissions. Nothing downstream
could detect that: the guard validates a signature, every `actorOf` copies the
claims verbatim, and nothing compares `mv`.

**For up to `JWT_ACCESS_TTL_SECONDS` a person holds two valid tokens naming two
organizations.** Nothing revokes an access token and building a revocation list
is a platform-wide change. This is the staleness ADR 0014 already accepts, but
that ADR argues about a membership _changing underneath_ a token rather than a
person _deliberately changing context_, so it is stated here in its own words
instead of inherited silently. Both tokens are ones this person was entitled to;
neither reaches anything they could not already reach.

**`analytics-service` counts a multi-organization person in one organization,
and this makes that easier to notice.** `user_snapshots` is keyed on `userId`
alone. It is already wrong today — the bootstrap membership claims the row
first — so this sprint did not cause it and deliberately did not fix it:
rekeying needs a migration, a backfill, and a correction to an in-memory double
that currently disagrees with Prisma about the behaviour being changed.

**`INTERNAL_SERVICE_TOKEN` is still optional in auth-service.** Its env comment
says it becomes required "in the phase that makes the claims decide something",
and this looks like that phase — but the auth integration suite runs without
organizations-service, so flipping it turns every login in that suite into a 503. The order is to teach the suite to override the resolver at the boundary
first, in a sprint that owns that change.

**Nothing compares `mv`.** Making it load-bearing while `org` becomes mobile
would validate two claims and silently pass three stale ones, which reads as a
complete guarantee and is not.
