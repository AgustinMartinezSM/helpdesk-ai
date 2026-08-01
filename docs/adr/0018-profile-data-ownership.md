# ADR 0018 — Profile data ownership

- Status: Accepted (2026-07-31)
- Date: 2026-07-31
- Sprint: 9.6 (Profiles and organization-defined identity fields)

## Context

Sprint 9.6 makes profiles editable: a person fixes their own phone number,
an organization defines an employee-number field and fills it. Until now
`user_profiles` was a pure projection of `user.registered.v1` — seeded once,
edited by nobody, documented as disposable, with a rebuild path in
`data-ownership.md`. ADR 0013 leaned on exactly that purity when it rejected
putting memberships here: "making it authoritative would make one service
simultaneously a rebuildable projection and an irreplaceable source of
truth".

Editable profile data has to live somewhere, and every candidate bends
something:

- **organizations-service** owns org-scoped rows and already has the
  memberships — but ADR 0013 scoped it deliberately to the authorization
  substrate ("who belongs where, and may do what"), and an employee number
  decides nothing about access. Widening the service that evaluates
  permissions with display data grows the wrong blast radius.
- **A new profile service** fails the test ADR 0013 itself applied in the
  other direction: profiles and the people directory are one bounded
  context, and users-service already serves the directory, holds the
  org-scoped `directory_memberships` projection, and has the public face
  (gateway route, JWT verification).
- **users-service** costs the purity: the moment a person edits a field,
  the table can no longer be dropped and replayed.

## Decision

**users-service owns profile data. `user_profiles` becomes a hybrid: the
identity seed stays a projection, the profile fields become source of
truth.**

Concretely:

- `userId` and `email` continue to be projected from `user.registered.v1`;
  that consumer is untouched and replay-safe (it upserts identity fields
  and never touches profile fields).
- Person-level profile fields (preferred name, display name, phone,
  language, timezone) are owned rows: edited through the API, never
  written by any consumer.
- Organization-defined field definitions and their values are owned tables
  in `helpdesk_users`, with a real FK between definition and value —
  possible only because they live in one database, which is half the reason
  they live together.

**What this costs, stated plainly: profile edits are not rebuildable.**
`data-ownership.md`'s rebuild row for `user_profiles` changes from "GAP:
needs an auth listing" to "identity columns re-seedable (same GAP); profile
columns and field values are source of truth — losing them is losing data".
users-service joins organizations-service as a service whose database is
not disposable. The alternative was pretending otherwise while user edits
quietly accumulated in a table documented as safe to drop, which is how
documentation becomes fiction.

**What this deliberately does not change**: organizations-service keeps the
authorization graph and nothing else moved there; `directory_memberships`
stays a reconcilable projection with its operator script; ADR 0017's
boundary holds — nothing in these tables is a login identifier, email stays
uneditable here, and no profile write is a credential operation.

## Consequences

Positive:

- Profiles, directory, field definitions and values form one cohesive
  service with real referential integrity between them.
- The authorization substrate stays narrow.
- Self-service profile editing needs no cross-service choreography.

Negative / accepted:

- users-service's database stops being disposable. Backup posture changes
  from "nice" to "required" the day this deploys anywhere real.
- The projection consumer and the API now co-own one table and must never
  overlap columns; the schema comment names which columns belong to whom,
  and the consumer's upsert is pinned by a test to leave profile columns
  alone on replay.

## Related

ADR 0013 (why not organizations-service, and the purity this trades away),
ADR 0017 (the credential boundary this respects), §14 of the master brief
(the field model this implements).
