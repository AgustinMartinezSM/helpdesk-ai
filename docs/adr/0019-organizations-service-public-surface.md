# ADR 0019 — The public surface of organizations-service

- Status: Accepted (2026-08-02)
- Date: 2026-08-02
- Sprint: 9.8 (Invitations and the public face of organizations-service)

## Context

organizations-service has been reachable only by other services since it was
created in Sprint 9.2. That was a deliberate property, not an omission, and
the repository says so in four places — the module comment, the env schema
comment, the bootstrap comment beside the CORS call, and `SECURITY.md`'s
paragraph on `INTERNAL_SERVICE_TOKEN`, which argues that what the credential
opens sits "on a service deliberately absent from the api-gateway routing
table — a browser has no path to it".

Three sprints have now bent around that property rather than revisiting it:

- **9.5** put the branch and station pickers in tickets-service, because the
  create-request form needed structure data and the service that owns
  structure had no route a browser could reach. tickets-service serves
  `GET /tickets/branches` from a projection of another service's rows.
- **9.5** also shipped the branch/department/station operator endpoints as
  `/internal/*`, guarded by the shared service credential, with a comment
  calling them an interim stopgap until the people-management sprint.
- **9.6** placed organization-defined profile fields in users-service. That
  decision stands on its own merits (ADR 0018), but "users-service already
  has the public face" was one of the reasons given.

Sprint 9.8 is where the deferral stops being free. An invitation has to
consume a one-time code and create a membership in the same transaction, and
the membership row lives in `helpdesk_organizations`. There is no outbox
(ADR 0006) and no consumer retry, so splitting that write across services
turns a crash into a burned code with no membership — a person locked out of
the only path they were given, with no recovery, because the code's secret is
not derivable from anywhere.

## Decision

**organizations-service gains a public HTTP surface: an api-gateway route,
access-token verification, and per-route permission checks. The internal
surface keeps its own credential and does not change.**

Concretely:

- The gateway mounts `/api/organizations` → `/organizations`, using the same
  `{pathFilter, rewriteTo, target}` shape as the other seven services and a
  new `ORGANIZATIONS_SERVICE_URL`. A narrower subtree mount was considered
  and rejected: `pathFilter` is a plain prefix test, so a subtree protects
  `/internal/*` no better than the full prefix does, and it guarantees a
  second mount the first time another public route ships.
- The service registers `JwtModule` with `JWT_ACCESS_SECRET` **for
  verification only** — it never signs — and uses `JwtAccessGuard` as an
  ordinary provider rather than an `APP_GUARD`, so `/internal/*` keeps
  `InternalServiceGuard` and no existing route changes meaning.
- Public routes check a permission key from the token and derive the tenant
  from it through `requireOrganization`. The service that evaluates
  permissions now also consumes them, which is not circular: the evaluator
  reads stored membership rows, the guard reads a signed claim, and where a
  decision must not tolerate a stale claim the use case reads the row (Sprint
  9.8's D7).
- **The gateway strips `x-internal-service-token` from inbound requests.**
  The proxy forwarded every header verbatim, which was safe only while no
  host behind it had an internal surface. That is no longer true, so the
  strip is what preserves the property the design already depended on. It
  applies to all services: nothing outside the cluster has any business
  presenting a service credential.
- CORS stays off on both the gateway and organizations-service. The browser
  path remains web → web-bff → gateway, unchanged.

### What I considered

**Keep proxying through another service.** tickets-service already fronts
structure data, and the same trick would work for invitations. It loses on
the transaction: the membership write would still have to happen in
organizations-service, over the internal hop, after the invitation was
consumed elsewhere — reintroducing exactly the split this decision exists to
avoid. It also spreads organization concerns across a service whose bounded
context is tickets, which is how a monolith grows inside a set of services.

**Put invitations in auth-service.** It has the public face already and it
owns credentials, which an invitation code resembles. It loses on ADR 0013:
auth-service answers who a person is, never what they may do where, and an
invitation names a role template. Widening it to know about templates is the
boundary ADR 0013 drew explicitly, and the cross-database seam comes back
anyway at acceptance.

**Widen `/internal/*` and let the BFF present the service credential.** This
is the cheapest change and the worst one. It would put a process credential
in the request path of a person's action, make every admin act
unattributable at the service that records who may do what, and it is the
shape ADR 0016 forbids in the ticket domain for the same reason.

### Why I did not simply defer again

The honest version of "defer" is "build the feature somewhere it does not
belong". Each of the three previous deferrals had a real local justification
and each one moved a piece of organization data or organization behaviour
into a service that does not own it. A fourth would have moved the invitation
lifecycle. The interest on that debt is paid by whoever later has to move it
back, and the amount grows with every sprint that adds a caller.

## Consequences

Positive:

- The service that owns memberships owns the transaction that creates them.
  Acceptance is one commit in one database, and a crash leaves the code
  unconsumed rather than the person locked out.
- The interim `/internal/*` operator endpoints from 9.5 now have a defined
  replacement path: a public route with a permission key and an
  attributable actor, added per capability as call sites appear.
- The permission vocabulary and its evaluator stop being split across a
  service that can enforce and a service that can only advise.

Negative / accepted:

- **`INTERNAL_SERVICE_TOKEN`'s risk profile changes.** Half of why its
  missing rotation story was tolerable is the sentence in `SECURITY.md` that
  this ADR falsifies. Sprint 9.8 pays part of that back — the header strip
  above, and a verifier that accepts a previous value so the secret can
  actually be rotated — and `SECURITY.md` is corrected in the same change.
  Per-caller identity, and with it any audit record of which process called,
  is still not built.
- One more service depends on `JWT_ACCESS_SECRET` being the same string
  auth-service signs with. Six verify with it today (ai, analytics, audit,
  notification, tickets, users); this makes seven, and organizations-service's
  env schema and `.env.example` now say so where they used to explain why the
  variable was deliberately absent.
- Four comments and one security paragraph asserting the old property have to
  be rewritten. That is the cost of having written the reason down, and it is
  cheaper than the alternative, where the reason was never recorded and
  nobody notices it stopped being true.

## Related

ADR 0013 (why the membership lifecycle is this service's), ADR 0006 (no
outbox — the reason the transaction cannot be split), ADR 0011 (the service
credential's missing rotation and audit story), ADR 0002 (the gateway/BFF
split this extends by one route).
