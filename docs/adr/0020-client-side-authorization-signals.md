# ADR 0020 — Client-side authorization signals

- Status: Accepted (2026-08-02)
- Date: 2026-08-02
- Sprint: 9.9 (The people-management surface)

## Context

Since the permission migration, every authorization decision in the platform
reads a permission key from a verified token claim. The browser was never part
of that migration, and it shows: the session object it receives is
`{ accessToken, expiresInSeconds, user: { id, email, roles } }`, and the only
authorization-shaped code in `apps/web` is a local boolean built from the
legacy `roles` array:

```ts
// apps/web/src/app/(app)/tickets/[id]/page.tsx:81-85
const isStaff = Boolean(
  session &&
  (session.user.roles.includes('agent') ||
    session.user.roles.includes('admin')),
);
```

That boolean is already wrong, not merely old. Every server check it shadows
reads a permission: a `branch_manager` holds `tickets.change_status` through
the template map, but their auth-service `roles` row is `['user']`, so the UI
hides a control the server would allow. Nothing has broken yet because no
organization uses branch managers.

Sprint 9.9 makes this load-bearing. A people-management screen has to decide
whether to render an Invite button, and "is this person staff" is not a
question the permission model asks.

## Decision

**The session carries a permission-shaped field, computed server-side from the
same resolution that mints the token.**

```ts
interface BrowserSession {
  accessToken: string;
  expiresInSeconds: number;
  permissions: string[];
  organizationId: string | null;
  user: { id: string; email: string; roles: string[] };
}
```

`SessionService.issueSession` already resolves the membership and holds
`membership.permissions` in the same function that stamps them into the token.
Exposing them is an echo, not a new query: no extra round trip to
organizations-service, no second source of truth, and login and refresh stay
identical to each other because both already go through that one method.

`roles` stays in the response. It is display data — the account page renders
it — and removing it is a separate, larger change with no authorization
consequence now that nothing branches on it.

**`isStaff` is deleted rather than reinterpreted**, for the reason ADR 0015
gave when it deleted the server-side twins: changing what a symbol means lets
the mismatch drift silently, while removing it makes every call site a compile
error somebody has to look at. Each of its three gates takes the key the
corresponding use case actually checks.

**Client gates are cosmetic. This does not change.** ADR 0015 rule 2 says
permission checks are server-side and the frontend may only hide; that rule is
what makes the staleness below acceptable rather than dangerous.

### What I considered

**Decode the JWT in the browser.** The token is already there, in memory, and
`perms` is inside it — this costs nothing and needs no backend change. I
rejected it because it makes every page depend on the token's internal format.
Renaming a claim would then break the UI silently and in a way no server test
would catch, and the token's shape would stop being auth-service's private
business. A response field is a contract; a claim is an implementation detail
that happens to be readable.

**Call the endpoint and render the 403.** Honest, needs nothing new, and it is
what the server does anyway. As the only mechanism it is a bad interface: a
requester would see an Invite button that always fails, and discovering what
you may do by being refused is not a design. It survives as the FALLBACK — see
staleness — which is the role it is actually good at.

**A coarse capability object** (`{ canInvite, canManagePeople }`) computed
server-side. Rejected as a second vocabulary: it would need its own naming
decisions, its own drift risk against `PERMISSIONS`, and a place to live. Raw
keys reuse the vocabulary `libs/security` already owns, which both sides
import, so producer and consumer cannot disagree on spelling.

## Consequences

Positive:

- The client and the server answer authorization questions from the same
  vocabulary, resolved in one place, at one moment.
- Deleting `isStaff` removes the last thing in the product branching on role
  names, and closes the drift the handoff has carried since the migration.
- No new endpoint, no new call, no schema change.

Negative / accepted:

- **The field is a snapshot and goes stale exactly as fast as the token** —
  up to `JWT_ACCESS_TTL_SECONDS`, 900 by default, and nothing compares `mv`.
  A demoted admin keeps seeing controls they can no longer use for up to
  fifteen minutes. The server refuses (`IssueInvitationUseCase` reads the
  stored membership, not the token), so the exposure is a confusing message,
  not an escalation — and the UI must render that refusal as a real error
  rather than treating it as impossible. This is the same bounded staleness
  ADR 0014 accepted for `perms` itself; the browser now inherits it visibly.
- Four type declarations in a chain must be edited together or a new field is
  silently dropped: auth-service's `Session`, the BFF's `UpstreamSession`, its
  `toBrowserSession`, and `apps/web`'s `BrowserSession`. That chain is the
  cost of the BFF pattern and it already existed.
- `owner` and `organization_admin` resolve to the same permission set, so no
  permission-derived UI can distinguish them. A screen that needs to show WHO
  the owner is must read a role template, which is display data, not an
  authorization signal — and this ADR is careful not to let the two merge
  again.

## Related

ADR 0015 (the permission model, and rule 2 — hiding is not authorization),
ADR 0014 (bounded claim staleness, which this inherits), ADR 0002 (the BFF
that carries the field), ADR 0019 (the public surface whose controls this
gates).
