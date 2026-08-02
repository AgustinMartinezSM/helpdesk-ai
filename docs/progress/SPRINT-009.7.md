# Sprint 9.7 — Operational stations and the shared-terminal design

Status: **Implemented and verified locally (2026-08-01).** The Definition of
Ready below was written and checked before any code; the outcome record at
the end says what landed against it. Design-heavier than its neighbors on
purpose: the done-when includes "security tradeoffs are documented", and
half of the nominal scope already shipped in 9.5.

## Definition of Ready

**Previous dependency complete.** Sprint 9.6 is merged with remote CI green
(`d05fcbe` at the time of writing). Stations already exist as registered
rows under branches (9.5): code, name, area, responsible manager, status,
station events, a projection in tickets-service, and — the part of this
sprint's done-when that is already true — **a ticket already identifies both
the employee and the station**, validated fail-closed at creation.

**Real state known.** What does NOT exist: any client behavior that
remembers which station a computer sits at, any session posture for a
shared machine (the refresh cookie lives 14 days and persists across
browser restarts), and any way for the create-request form to carry the
context automatically. The web form does not send branch or station at all.

### Product objective

The store computer at cashier 2 files requests that say so, without anyone
retyping it and without a shared password. A person still signs in as
themselves; the machine remembers the place, never the identity.

### The five modes, evaluated (the design half of the done-when)

ADR 0016 drew the line — a station is a place, never a principal — and
named the first increment. Against the master brief's five candidate modes:

1. **Individual login on a branch computer + remembered station context —
   THE FIRST INCREMENT, built this sprint.** The machine remembers
   branch/station locally; each person authenticates as themselves with a
   session posture built for shared hardware. Traceability is perfect
   (operator = the authenticated person, station = remembered context), and
   no new credential type exists.
2. **Organization portal with remembered branch** — a subset of mode 1
   (remembering only the branch); falls out of the same implementation for
   organizations that do not register stations.
3. **Short PIN for an already-provisioned employee** — a real credential
   design: PIN issuance, rotation, lockout, recovery, per-organization
   uniqueness, its own audit events. Deferred exactly as ADR 0016 said;
   worth building only when a pilot shows password login on the till is too
   slow in practice. Nothing in this sprint's model blocks it later.
4. **Kiosk-style requester mode** — an UNAUTHENTICATED surface; every
   request it filed would be attributable to a place but not a person,
   which crosses the line ADR 0016 forbids outright ("any flow where a
   request cannot be attributed to a person"). Rejected until a product
   decision deliberately weighs anonymous intake — that is a different
   feature (a complaint box), not a cheaper login.
5. **Manager-created temporary session** — operator impersonation with
   extra steps: the requests would carry the manager's identity or a
   synthetic one. Rejected; the invitation flow (9.8) is how a person who
   cannot sign in gets an account.

**Forbidden at any increment** (restating ADR 0016 as acceptance): a
permanent shared password, an account named after a till, any
unattributable request path.

### Acceptance criteria

1. **Shared-workstation session posture**: login can declare the machine
   shared; the refresh credential then lives hours, not weeks, and dies
   with the browser (session cookie, no Max-Age). The flag can only SHRINK
   a session — a client hint that reduces access is trustworthy by
   direction. Server-enforced TTL; new env var, no new secret. Done when
   auth tests pin both TTL paths and the cookie shape difference.
2. **Remembered station context in the web app**: the create-request form
   offers the branch picker (and stations when the branch has them) from
   the 9.5 endpoints, remembers the choice locally on the machine
   (localStorage — context, never identity, never a credential), pre-fills
   it for the next request from that computer, and lets the person clear
   or change it. An organization with no branches sees exactly today's
   form. Done when form tests cover pick/remember/prefill/clear and the
   no-branches case.
3. **Traceability documented end to end**: requester id (person) and
   station id (place) on the ticket row, org-scoped and queryable; the
   sprint doc records WHERE attribution lives and the one gap — ticket
   events still carry no station (D5 stands; the audit trail links the
   fact to the row by ticketId). The v3 payload moment arrives with
   routing (9.11), which needs branch on events for its own reasons; the
   station rides along then.
4. **Provenance stays advisory, stated loudly**: nothing verifies that a
   request claiming cashier 2 came from that machine until device
   registration exists (a later increment with its own credential story).
   The context is operational convenience plus honest labeling, not
   evidence.

### Technical scope

- auth-service: `sharedWorkstation?: boolean` on the login DTO;
  `JWT_REFRESH_SHARED_TTL_SECONDS` (default 43200 — a shift and a half;
  no default change for normal sessions); the login use case picks the TTL.
  Refresh ROTATION preserves the original session's posture: a session
  born shared stays short — the stored token's expiry window is what
  rotation inherits, so no schema change is needed (verify; if rotation
  today re-derives TTL from env alone, the row needs a posture bit and the
  DoR prefers deriving over adding a column).
- web-bff: passes the flag through; sets the refresh cookie WITHOUT
  Max-Age when shared (dies with the browser). No other contract change.
- apps/web: login form checkbox ("computadora compartida"); create-request
  form pickers + localStorage (`helpdesk.station-context`, value =
  branch/station ids + labels for display); prefill and clear.
- No organizations-service changes, no tickets-service changes, no new
  events, no migrations anywhere.

### Security boundaries

- The shared flag only shortens; omitting it changes nothing. A forged
  "shared" costs the forger session length — the safe direction.
- localStorage holds ids and labels of PLACES, never tokens, never
  identity. The refresh credential in shared mode is deliberately NOT in
  localStorage — it stays in the httpOnly cookie, now session-scoped.
- Station/branch ids from the client remain validated server-side against
  the projection (9.5); a remembered id from another organization is
  refused like any other foreign id.
- Adversarial tests: shared flag with a long-TTL replay attempt (rotation
  must not extend); remembered foreign station on submit → 422.

### Migration impact

None. No schema changes. Rollback is a code revert.

### Test strategy

Unit on the TTL selection and cookie shape (auth + BFF); component tests on
the web form (pick/remember/prefill/clear/no-branches); the existing
integration suites must stay green; full gate before push.

### Explicitly out of scope

PIN login, kiosk mode, device-bound credentials and device registration
(each a real credential design, per ADR 0016); inactivity auto-logout in
the client (the shortened server TTL is this increment's expiry story;
idle-timeout UX belongs to the role-experience work); people management
(9.8); any event payload change (D5 stands until 9.11).

### Ready?

Dependency complete, state known, the design half is written above, the
implementation half is additive and revertible, scope fits one coherent
sprint. Proceeding under the standing autonomous authorization.

## Outcome record (2026-08-01)

The design half is the DoR above; the implementation half landed in one
commit (`068c246`) plus the opening (`8146291`). Every acceptance criterion
holds:

- **The posture only shrinks, provably.** min() caps every requested TTL at
  the configured normal one, so a forged flag or a misconfigured shared TTL
  is inert; a dedicated test constructs the oversized case and watches the
  cap win. Rotation inherits the window the presented token was BORN with,
  derived from the row's own timestamps — a shared session cannot stretch
  itself by rotating, a normal session keeps exactly its old window, and no
  posture column exists to drift.
- **The cookie dies with the browser** in shared mode: no Max-Age, no
  Expires, pinned by a BFF test that also proves the flag reached
  auth-service. The BFF decides the cookie shape from the request it itself
  forwarded — no upstream echo field needed.
- **The machine remembers the place, never the identity.** localStorage
  holds ids and labels of a branch and a station; the specs assert the
  stored value contains no token; a remembered id that no longer exists is
  dropped and forgotten, and a server 422 clears it too. The
  no-branches organization renders exactly yesterday's form.
- **Traceability and its one gap, stated**: requester and station live on
  the ticket row, org-scoped; ticket events still carry neither (D5), and
  the v3 payload moment arrives with routing (9.11). Provenance stays
  advisory until device registration exists — the context is honest
  labeling, not evidence.

What was deliberately not built matches the DoR's exclusions: no PIN, no
kiosk, no device binding, no idle-timeout UX. One deviation of wording: the
DoR sketched es-AR checkbox copy, but the application's UI is English until
i18n lands in 10.8, so the copy follows the codebase — localization is
content work for that sprint, not this one.

### Verified

auth-service 45 unit tests (TTL selection both ways, the cap, rotation
inheritance) plus its integration suite against the real database; web-bff
22 (cookie shapes, flag forwarding, picker pass-throughs); web 122 across
17 suites (pick/submit/remember/prefill/forget/stale-drop, the shared
checkbox posting the flag, and every pre-existing spec untouched); Next
build green. The full gate plus all nine integration suites and the remote
CI result are recorded in the handoff as usual.

## Documentation

Meaningfully changed this sprint: this document (the five-mode evaluation
is the durable part), and the handoff. ADR 0016 needed no amendment — the
increment implemented is the one it already named. No fictional experience,
customers, incidents or approvals were introduced.
