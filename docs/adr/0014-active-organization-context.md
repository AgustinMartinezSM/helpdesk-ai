# ADR 0014 — Active organization context

- Status: **Proposed** (Sprint 9.1 audit; not approved)
- Date: 2026-07-30
- Sprint: 9.1 (Product domain and tenancy audit)

## Context

A request has to arrive at a service carrying a trustworthy answer to "which
organization is this person acting in right now". This ADR decides how that
answer travels, and it is the single most security-critical decision in the
migration: get it wrong and every other control is decoration.

The audit produced one fact that settles most of it.

**Neither the gateway nor the BFF performs any authorization.** I verified
this directly rather than taking it on trust. `apps/api-gateway/src/main.ts`
mounts seven identical `createServiceProxy` pass-throughs (lines 29-77); its
`AppModule` declares only the observability module, a health controller and
the env provider. A grep for `JwtModule|UseGuards|JwtAccessGuard|authorization`
across `apps/api-gateway/src/` matches **only its own spec file**. The BFF is
the same: it forwards the caller's bearer header verbatim and imports
`@helpdesk-ai/security` nowhere at all. What it does own is the httpOnly
refresh cookie — it is a credential-custody and CORS layer, not a policy
layer.

The second relevant fact: the access token is the entire authorization
context every downstream service ever sees. There is exactly one signing
site — `apps/auth-service/src/infrastructure/security/jwt-token-issuer.ts:21`,
`signAsync({ email, roles }, { subject: claims.sub })` — producing
`sub, email, roles, iat, exp, iss`. No `jti`, no session id, no scope.

## Why a client-supplied organization header is not merely risky here — it is unenforceable

The master prompt asks for an explicit analysis of `x-organization-id`. In a
platform with a policy-enforcing gateway, such a header can be made safe: the
gateway strips whatever the client sent and re-injects a validated value, and
downstream services trust it because nothing else can reach them.

**This platform has no layer that could do that.** The gateway is
`http-proxy-middleware` with `pathFilter` and `rewriteTo` and nothing else; it
forwards headers as they arrive. So if any service trusted an
`x-organization-id` header, the full attack would be: open devtools, add the
header, read another company's tickets. There is no strip, no validation and
no second gate — `tickets-service` has exactly one layer that decides access,
and it would be reading an attacker-controlled string.

Building that capability is possible — put a guard in the gateway that
verifies the JWT, resolves membership and rewrites the header — but it means
the gateway becomes a policy layer, gains the shared JWT secret, gains a
synchronous dependency on organizations-service, and becomes a single point
of failure for every request. That is a much larger change than putting a
claim in a token that is already signed and already verified everywhere.

**Decision: no service ever reads tenancy from a header.**

## Decision

**The active organization travels inside the signed access token**, as
claims, and downstream services read it only from the verified payload.

The token gains three claims:

| Claim   | Meaning                                                       |
| ------- | ------------------------------------------------------------- |
| `org`   | The active organization id                                    |
| `perms` | Resolved permission keys for this person in that organization |
| `mv`    | Membership version — bumped whenever the membership changes   |

`roles` stays for now, as a compatibility claim, and is removed once every
call site reads `perms` instead. The `Actor` type in `libs/security` gains
`organizationId` and `permissions`, which is what makes the change visible to
the compiler at all eleven authorization call sites.

**Switching organizations mints a new token.** auth-service validates the
requested organization against an active membership at mint time and refuses
otherwise. There is no "switch" that a client performs on its own; it is a
token exchange, so the server decides.

**Resolution happens at mint time, not per request.** auth-service calls
organizations-service when issuing or refreshing a token. Downstream services
gain no synchronous dependency on organizations-service at all — they read a
claim from a signature they already verify. This matters: it keeps the
seven-service fan-out unchanged, and it means an organizations-service outage
degrades login rather than taking down every read path in the platform.

## The tradeoff I am accepting, stated plainly

Claims are a snapshot. A membership suspended at T is still in a token minted
at T−1 until that token expires.

The staleness ceiling is the access-token TTL — 900 seconds by default
(`apps/auth-service/src/config/env.ts:28-33`). The system already has exactly
this property for roles: refresh re-reads the user from the database
(`refresh-session.ts:44`), so a role change today takes effect within one
TTL. Tenancy would ride the same machinery rather than inventing new
behaviour.

Fifteen minutes of residual access after a suspension is defensible for
reading a ticket queue. It is not defensible for everything, which is why
`mv` exists: a service that cannot tolerate staleness re-validates the
membership version before acting. I would apply that to the operations where
the cost of being wrong is high — anything under `organization.manage_*`,
`people.assign_roles`, and export — and accept the TTL everywhere else.

The alternative, checking membership synchronously on every request, buys
immediate revocation and costs a network call on every single authorization
decision plus a hard dependency from all seven services to
organizations-service. I do not think immediate revocation is worth that here,
and I would rather write the tradeoff down than have it discovered later.

**Refresh tokens need attention that this ADR does not settle.**
`refresh_tokens` is keyed only by `user_id` with no column for which
organization a session belongs to (`apps/auth-service/prisma/schema.prisma:41`).
If a session is per-organization, that is a new column and reuse-detection
semantics change. If a session is per-person and the organization is chosen
per access token, it does not. I lean towards the second — a session belongs
to a human, not to a workspace — but it needs deciding before implementation.

## What this does not solve

A claim tells a service which organization the caller is acting in. It does
**not** scope the query. `apps/users-service` lists the entire directory with
an unfiltered `findMany` including every email
(`prisma-user-profile.repository.ts:33-35`); `analytics-service` runs five
completely unscoped aggregates; `audit-service` never passes the actor to the
repository at all. Adding the claim without also scoping those queries
produces a system that _looks_ tenanted and leaks anyway.

That is the substance of ADR 0012's warning and the reason the migration plan
sequences read paths before write paths.

## Consequences

Positive:

- Tenancy rides a signature that is already verified in every service. No new
  trust boundary, no new header to validate, nothing for a client to forge.
- No new synchronous dependency for the six services that only read.
- The change is visible to the compiler: adding `organizationId` to `Actor`
  breaks every call site that has not been updated — provided the duplicate
  local copies of `Actor` are removed first (see ADR 0015).

Negative / accepted:

- Bounded staleness on membership changes, ceiling one access-token TTL.
- Tokens grow. `perms` for an agent is a modest list, but an organization
  owner's is not; if it becomes unreasonable, the fallback is a role template
  id plus server-side expansion, at the cost of a lookup.
- auth-service gains a synchronous dependency on organizations-service at
  mint time, and login fails if it is unavailable.

## Related

ADR 0013 creates the service consulted at mint time. ADR 0012 explains why a
claim alone is insufficient without scoped queries. ADR 0015 defines what
`perms` contains.
