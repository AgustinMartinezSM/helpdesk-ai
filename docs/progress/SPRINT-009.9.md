# Sprint 9.9 — The people-management surface

Status: **Implemented and verified locally (2026-08-02).** The Definition of
Ready below was written and checked before any code; the outcome record at the
end says what landed against it. This is the first product surface for
anything built since 9.5, and the first sprint since 7.6 whose deliverable is
a screen rather than an API.

## Definition of Ready

**Previous dependency complete.** Sprint 9.8 is merged with remote CI green
(`0ecccd4` at the time of writing). Invitations, the people directory,
profiles, branch structure and the permission evaluator all exist and are
tested. None of them is reachable from the product.

**A note on the number.** Three documents reserved 9.9 for bulk/CSV import
(9.5's out-of-scope list, 9.6's, and 9.8's), and the people UI was carried as
the unnumbered "Block B". I am taking 9.9 for the UI and moving import behind
it, deliberately: an import loads hundreds of people that nobody can then see,
invite, or correct, because there is no screen. Import after the surface is a
feature; import before it is a way to fill a database. The older lists are
left as they are — they are the record of what was planned when.

**Real state known, and the gap is wider than "no pages exist".** The
authenticated product today is one navigation link (`/tickets`), and the
browser's entire notion of who it is talking to is three fields:
`{ accessToken, expiresInSeconds, user: { id, email, roles } }`
(`apps/web/src/lib/session.ts:12-22`). Four things follow, and each one
shapes a decision below:

- **The browser cannot reach either people API.** web-bff has exactly four
  controllers — health, session, tickets, ai — so `/api/users` and
  `/api/organizations` have no door, and CORS is off everywhere else.
- **The browser has no permissions.** The `perms` claim is physically present
  (the access token is a plain HS256 JWT held in React state) but no session
  field carries it and nothing decodes it. The only authorization-shaped code
  in the whole app is one local `const isStaff` keyed on
  `session.user.roles.includes('agent') || ...('admin')`
  (`apps/web/src/app/(app)/tickets/[id]/page.tsx:81-85`) — the legacy column,
  not the permission vocabulary. It is already wrong: a `branch_manager` holds
  `tickets.change_status` server-side and would have the control hidden.
- **There is no registration UI anywhere.** A repo-wide grep for a register
  route in `apps/web` finds only prose, and web-bff exposes login, refresh,
  logout and me — not register. So 9.8's redemption walk ("register, sign in,
  redeem") has no first step inside the product.
- **The component vocabulary is missing exactly what an admin screen needs.**
  No table, no modal, no toast, no confirmation prompt, no copy-to-clipboard,
  and no icons for the people verbs. Empty, loading and error states are
  well-established and reusable.

### Product objective

An admin opens People, sees who is in their organization, invites a colleague,
and hands them something that works. The colleague — who may have no account
at all — creates one, redeems, and lands in the organization with the intended
role. Nothing in the interface claims the platform sent anything, because it
did not.

### User stories and acceptance criteria

1. **An admin sees the people of their organization.** `/people` lists active
   members with display name, email, role and membership status, scoped to the
   caller's organization by the server. Done when a member of org B never
   appears for org A's admin, and when an organization of one renders a
   sensible page rather than an empty shell.
2. **An admin invites someone and can hand over what they get.** The invite
   form takes an email and a role; the response shows the code **once**, with
   a copy control and copy that says plainly that the platform sent nothing
   and the code is theirs to deliver. Done when the code is never re-fetched
   or re-rendered from a list, and a component test proves navigating away
   loses it.
3. **An admin sees and withdraws outstanding invitations.** Pending, accepted,
   revoked and expired are distinguishable; revoke asks for confirmation
   before it fires. Done when the confirmation is required (a test asserts no
   request on first click) and an expired row reads as expired rather than
   pending.
4. **A newcomer with no account gets in.** They register, sign in, see who is
   inviting them and to what **before** committing, redeem, and their next
   token carries the organization. Done when the walk works end to end for an
   account that did not exist, and when the session refresh after redemption
   is what makes the organization appear — not a page reload.
5. **What the UI hides matches what the server refuses.** Every control gated
   in the client is gated on the same permission key the use case checks, and
   nothing is gated on `roles`. Done when `isStaff` has no definitions left
   and a test proves a permission-derived control appears and disappears with
   the permission rather than with a role name.

### Technical scope (decisions D1–D10)

- **D1 — The session gains a permission-shaped field, and that is this
  sprint's structural decision.** `issueSession` already holds
  `membership.permissions` at mint time (`session.service.ts:77`), so exposing
  them is an ECHO of what the token already says — no second round trip, no
  new resolver call. The session gains `permissions: string[]` and
  `organizationId: string | null` alongside `user`. Recorded in **ADR 0020**
  with the alternatives: decoding the JWT client-side (rejected — it couples
  every page to the token format, so a claim rename breaks the UI silently and
  invisibly), and calling and rendering the 403 (rejected as the primary
  mechanism — it is correct but it means showing a requester an Invite button
  that always fails; it stays the fallback for the stale window). The field is
  a SNAPSHOT and goes stale exactly as fast as the token: up to
  `JWT_ACCESS_TTL_SECONDS`, 900 by default, with nothing comparing `mv`. The
  DoR accepts that and names the consequence in Security boundaries.
- **D2 — `isStaff` is deleted, not adapted, and replaced per control.** The
  same argument ADR 0015 used for the server: changing its meaning would let
  the mismatch drift silently, while removing the symbol forces every call
  site to be looked at. Its three gates get the key the server actually
  checks — status transitions `tickets.change_status`, the AI panel
  `tickets.note_internal`, the requester's close button its existing
  own-ticket domain rule. A tiny `hasPermission(session, key)` helper lives in
  `apps/web/src/lib/permissions.ts`, importing `PERMISSIONS` from
  `@helpdesk-ai/security` so the spelling cannot drift between client and
  server.
- **D3 — Registration ships, because without it the feature does not work for
  the person it exists for.** auth-service has `POST /auth/register` already;
  what is missing is a BFF route and a page. The invited newcomer is the
  primary case, and 9.8's DoR named the four-step walk as its own weakness.
  The page is `(public)/register` — a client page inside the public group, the
  precedent `login` already set — and it signs the person in on success so the
  walk is register → redeem, not register → log in → redeem.
- **D4 — Two new BFF controllers, thin pass-throughs with no policy.** `people`
  → `/api/users/*` and `invitations` → `/api/organizations/invitations/*`,
  modelled on `ai.controller.ts`: copy the caller's `authorization`, build
  correlation headers, rethrow non-2xx verbatim. The BFF adds no authorization
  of its own — it never has, and the day it starts is the day two places
  decide access. `GatewayClient` stays GET/POST/PATCH; every route this sprint
  needs already fits, which is not an accident (9.8 chose POST for revoke for
  this reason).
- **D5 — The directory rows gain `roleTemplate` and `status`.** A People page
  that cannot say who is an admin is a contact list. users-service already
  holds both in its `directory_memberships` projection — the join is local,
  the data is already tenant-scoped, and no new service call appears. This is
  the only users-service change in the sprint.
- **D6 — An invitation can be previewed before it is spent.** Today the
  redeemer learns which organization and which role only from the accept
  response, by which point it is irreversible; and no public endpoint anywhere
  returns an organization's NAME, so even the confirmation could only show a
  UUID. `POST /organizations/invitations/preview` takes the same code, changes
  nothing, and returns organization name plus role template. It is
  authenticated like accept, so it adds no anonymous surface, and it is not an
  oracle: the caller must already hold the secret, which is the same thing
  accept requires. Same refusal shapes as accept, so it leaks nothing accept
  does not.
- **D7 — The one-time code is treated as one-time in the interface.** It is
  rendered once, from the issue response held in component state, with a
  copy-to-clipboard control and an explicit line that the platform sends
  nothing. It is never put in a URL, never in a query string, never stored,
  and the list view cannot show it because the API cannot return it. A test
  asserts the code is gone after the panel is dismissed.
- **D8 — Three UI primitives are invented, and one deliberately is not.**
  A record list reusing the existing `<ul>`/`Card` row pattern rather than a
  new `<table>` (the app has no table anywhere, and the Card row is already
  responsive at 560px — a directory is the wrong place to debut a layout
  primitive); an inline two-step destructive confirmation (the button becomes
  "Revoke? Yes / Cancel") rather than a modal, because a correct accessible
  dialog with focus trapping is its own piece of work and this sprint needs
  one confirmation, not a dialog system; and a `CopyButton` with the clipboard
  interaction and a new copy glyph. No toast system: the established success
  pattern is a mounted `role="status"` live region plus focus parking, and it
  is enough.
- **D9 — The People entry is nav-gated on `people.read`, and the shell gets
  the a11y it was missing.** The authenticated nav is one hardcoded link
  today; it becomes a small array so a second entry does not mean a second
  hardcoding. While there: the authenticated shell has no skip link and its
  `<main>` has no id or tabIndex, both of which the public layout has had
  since 7.6 — a new section is the moment to stop the two shells diverging.
  `helpi-hints.ts` gets a `/people` entry, or the product shows a marketing
  hint inside the admin screen.
- **D10 — The public site stops saying something that will be false.**
  how-it-works states roles "are assigned outside the product — there is no
  administration UI" (`how-it-works/page.tsx:205-207`). After this sprint that
  is half false: an admin chooses a role WHEN INVITING, and still cannot
  change an existing member's role, because no public endpoint and no
  permission key for that exists. The sentence gets that distinction rather
  than deletion, and `product-status.ts` gains the People capability at the
  status ADR 0009 actually allows — with the note naming what is missing.
  `tenancy-current-state.md` quotes the same sentence and moves with it.

### Security boundaries

- **Hiding is not authorization, and this sprint must not blur that.** Every
  client gate is cosmetic; the refusal already exists in a use case
  (ADR 0015 rule 2). The acceptance criteria are written so a passing UI test
  never counts as an authorization test.
- **The permission snapshot is stale by design, bounded by the token.** A
  demoted admin keeps the Invite button for up to 900 seconds; the server
  refuses, because `IssueInvitationUseCase` reads the STORED membership rather
  than the token (9.8, D7). The UI must therefore render that 403 as a real
  message, not as an impossible state — the fallback D1 rejected as the
  primary mechanism is exactly what covers this window.
- **The invitation code never touches a URL, a query string, storage or a
  log.** One response, one render, one clipboard write.
- **Staff-only profile fields stay server-filtered.** The directory renders
  what the API returned and never filters client-side; the one view-filter in
  users-service remains the only thing deciding visibility (ADR 0018).
- **The redeemer is tenantless.** Every people page must handle a session with
  no organization — the belongs-nowhere state is real and normal between
  registering and redeeming (ADR 0014), and it is the state the redemption
  page is USED in. A page that assumes an organization will crash for exactly
  the person it was built for.
- **No new anonymous surface.** Preview and accept both sit behind the access
  guard; registration is anonymous but already existed and stays throttled by
  auth-service's credential limiter.

### Migration impact

None. No schema change in any service: the directory fields come from a
projection that already stores them, the session fields are computed at mint
time from data already resolved, and the preview reads rows that already
exist. Rollback is a code revert.

### Test strategy

`apps/web` specs live in `apps/web/specs/*.spec.tsx` with a per-file fetch
stub and a local `renderPage()` wrapper — the new work follows that rather
than introducing a shared harness mid-sprint. Coverage: the directory (rows,
empty organization, foreign-member absence), the invite form (validation, the
code shown once and lost on dismiss, the honest-delivery copy present), revoke
(no request without confirmation), the redemption walk (preview then accept
then session refresh), and permission-gated rendering asserted by swapping the
session fixture's `permissions` rather than its `roles`. New BFF controllers
get the `StubGateway` treatment already used for session, asserting both hops.
Full gate plus all nine integration suites before push.

**Two holes named rather than papered over**: `apps/web/specs` is included by
neither `tsconfig.json` nor `tsconfig.spec.json`, so those specs are
transpiled but never type-checked — pre-existing, and this sprint adds to the
pile rather than fixing it. And jsdom does not implement
`navigator.clipboard`, so the copy interaction is tested through an injected
writer rather than the real API.

### Explicitly out of scope

Changing an existing member's role, suspending or reactivating anyone — there
is no public endpoint and no permission key for membership management, and
inventing both is its own sprint. Branch assignment for an invited branch
manager, which still goes through the internal operator endpoint (the
attribution gap 9.8 named and this sprint does not close). Profile field
editing: it needs the field schema that sits behind `organization.update`, one
PUT per key with N partial-failure states, and a `GatewayClient` that speaks
PUT. A per-person profile page (`/people/[userId]`). Directory search,
filtering, sorting and pagination — `GET /users` offers none and adding them
is backend work. Pending invitees shown inside the member list (two lists,
two permissions, no join). Bulk/CSV import. Any modal or toast system. i18n —
the UI stays English until 10.8, and this sprint invents no new copy
conventions.

### Ready?

Dependency complete, and the state is known down to the four missing UI
primitives and the missing registration page. The structural decision has its
own ADR, and it is an echo of data the token already carries rather than a new
contract between services. Everything is additive and revertible; there is no
migration. The scope is large — comparable to 9.5 — and the cut is already
taken above rather than left to discover: no membership management, no profile
field editing, no search, no per-person page. Proceeding under the standing
autonomous authorization.

## Outcome record (2026-08-02)

Three commits: the opening (`fb0221f` — this DoR and ADR 0020), the session
and BFF work (`1b499bc`), and the screens.

**The authorization signal changed shape, and the specs are the proof.** The
session carries `permissions` and `organizationId`, echoed from the resolution
that already mints the token. `isStaff` is gone; its three gates check the key
the matching use case checks. The specs that exercised staff behaviour now say
`permissions: ['tickets.change_status', 'tickets.note_internal']` where they
used to say `roles: ['agent']` — which is the whole point, stated in the one
place that cannot drift from the code.

**Everything the sprint promised a person could do, they can do.** An admin
opens People, sees who is there and which role each holds, invites somebody,
gets a code that is shown once with the honest line that nothing was sent,
and can revoke — behind a confirmation that provably does not fire on the
first click. A newcomer with no account registers, sees who is inviting them
and to what, accepts, and lands inside. The session refresh after acceptance
is asserted, because without it the person joins and still appears to belong
nowhere.

**The belongs-nowhere state is handled everywhere it can occur**, which
matters more here than anywhere else in the product: it is not an edge case
on these screens, it is the state the redemption page is _used_ in.

### What the implementation decided that the DoR had left open

- **The directory shows a role but no membership status.** The DoR asked for
  both. The listing already filters to active members, so a status column
  would have said `active` on every row — a field that cannot vary is noise.
  It arrives with the increment that gives suspended and invited people a row
  at all.
- **`libs/security` gained a `/permissions` entry point.** Not in the DoR, and
  discovered by building: `apps/web` had no dependency on the library, and its
  package root exports `JwtAccessGuard`, which imports `@nestjs/common` and
  `@nestjs/jwt`. Sharing the vocabulary the obvious way would have pulled a
  server framework into a browser bundle to read a list of strings. The
  permissions module has no imports at all, which is what makes the second
  entry point safe by construction.
- **The BFF exposes registration but does not sign anyone in.** The DoR said
  the page would "sign the person in on success"; doing that inside the BFF
  would have put a credential decision in a layer that has never made one. The
  page issues both calls, and a spec pins the recoverable middle state — the
  account exists, the login failed, and the person is told.
- **`/register` needed a Suspense boundary.** `useSearchParams` opts a route
  into client rendering, and Next refuses to prerender the shell without one.
  The parameter carries only the INTENT to redeem (`?next=join`), never the
  code.
- **The nav array replaced one hardcoded link**, and the authenticated shell
  gained the skip link and focusable `<main>` the public layout has had since
  7.6. Adding a second destination is the moment the two shells stop
  diverging, not a later cleanup.

### Verified

apps/web: 139 tests across 20 suites, of which 16 are new — the directory
(rows, one-member organization, permission-gated invite form, the
belongs-nowhere redirect), the invitation code (shown once, honest delivery
copy, gone on dismiss), revoke (no request on the first click), the redemption
walk (preview does not spend the code, accept refreshes the session, an
already-belonging acceptance explains itself), registration (local refusal
before any request, register-then-login order, the recoverable failure), and a
stale-permission 403 rendered as a real message. web-bff 29 across 6 suites,
including a new controller spec asserting both hops and that the BFF adds no
authorization of its own. users-service 53, organizations-service 181.

The full gate — format, lint, typecheck, test, build — ran green across all 15
projects. In a real browser against the dev server: `/register` renders
complete, the authenticated shell shows the new skip link, and the nav shows
only Tickets for a caller with no session — the permission gate doing its job.

**One thing the browser check surfaced that this sprint did not cause and did
not fix**: with no BFF running, `AuthProvider`'s mount-time refresh never
settles, so an authenticated route sits on its loading state forever rather
than falling back to signed-out. That is how `/tickets` and `/account` have
always behaved; `refreshRequest` has no timeout. Worth a fix in the sprint
that owns session UX, not in this one.

### Still true after this sprint

Changing an existing member's role, suspending or removing them has no product
surface, no public endpoint and no permission key — `product-status.ts` says
`planned` and how-it-works now draws exactly that line rather than the old
blanket "roles are assigned outside the product". Assigning an invited branch
manager to their branches still goes through the internal operator endpoint,
which remains the sharpest unattributable step in onboarding. There is no
directory search, filter, sort or pagination; no per-person page; no profile
field editing. Nothing is deployed, and the platform still sends no email.

## Documentation

Meaningfully changed this sprint: ADR 0020 (new — the client-side
authorization signal and the three alternatives that lost),
`product-status.ts` (Invitations and People directory as available with the
delivery caveat stated in the note; Member administration as planned; the
role-based access wording, which described "role guards" the permission model
replaced), the how-it-works roles note (the sentence this sprint half
falsified, corrected to the distinction that is actually true), the security
page's authorization principle (it claimed roles travel in the token, which
phase 8 ended), `frontend-public-routes.md` (three new routes), the handoff,
and this document. `tenancy-current-state.md` quotes the same stale sentence
and was deliberately left alone: it is pinned to commit `43d4593` as an audit
snapshot, and editing it would falsify what it is. No fictional experience,
customers, incidents or approvals were introduced.
