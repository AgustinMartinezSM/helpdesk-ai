# Sprint 9.6 — Profiles and organization-defined identity fields

Status: **Implemented and verified locally (2026-08-01).** The Definition of
Ready below was written and checked before any code; the outcome record at
the end says what landed against it.

## Definition of Ready

**Previous dependency complete.** Sprint 9.5 is merged with remote CI green
(`b76e67a` at the time of writing): structure, branch-scoped visibility and
the membership lifecycle all stand. This sprint builds on the directory
projection and the permission model.

**Real state known.** `user_profiles` holds userId, email, displayName,
registeredAt — a projection of `user.registered.v1`, seeded once, edited by
nobody. There is no profile editing anywhere in the product, no per-person
preference, and no organization-defined field of any kind. ADR 0017 already
drew the line this sprint must not cross: a profile attribute never becomes
an authentication identifier.

### Product objective

Each company represents its people the way it actually works: a retail chain
requires an employee number and shows a job title; an eight-person shop uses
names and nothing else and is never asked to configure anything. People fix
their own phone number and preferred name without filing a ticket to an
admin.

### User stories and acceptance criteria

1. **A person edits their own profile**: preferred name, display name,
   phone, interface language, timezone — through `PATCH /users/me`, no
   permission needed beyond being themselves; values validated; a
   `profile.updated.v1` event announces WHICH keys changed and never the
   values. Done when self-edit round-trips and the event payload is pinned
   metadata-only.
2. **An org admin defines fields**: create with a stable key, both locale
   labels, a type (text, number, select, boolean, date, phone), required,
   editable-by-user, requester/staff visibility, display order, per-type
   declarative validation (length/pattern/min/max/options). The key is
   immutable after creation; everything else edits; archiving hides the
   field and refuses new writes while RETAINING stored values. Done when
   org A requires an employee number with a pattern while org B has zero
   configuration and zero burden.
3. **Values are set and validated**: the subject sets editable fields;
   `people.update` holders set any active field for members of THEIR
   organization; every write validates against the definition; clearing a
   required field is refused; a value for an archived or foreign field
   answers not-found. Done when the validation matrix is pinned per type.
4. **Staff-only fields do not leak** — the sprint's security headline. A
   response includes a field's value only if (staff view AND
   visible_to_staff) or (subject/requester view AND visible_to_requester);
   `people.update` holders additionally see what they can edit. Done when
   adversarial tests prove a staff-only value never appears in the
   subject's own view nor in any requester-facing response, across two
   organizations.
5. **The directory carries visible values**: `GET /users` (people.read) and
   a new `GET /users/:userId` return profile plus the values the viewer may
   see, scoped to the caller's organization through the existing
   directory-membership projection. Done when a member of org B is 404 to
   org A's admin.

### Technical scope (decisions D1–D7)

- **D1 — users-service owns profiles now, and `user_profiles` stops being a
  pure projection.** Person-level fields (preferred name, display name,
  phone, language, timezone) become source of truth in `helpdesk_users`;
  the identity seed (userId, email) remains projected from
  `user.registered.v1`, which keeps working untouched. This is the sprint's
  structural decision and it changes what a rebuild owes — recorded in
  **ADR 0018**, with `data-ownership.md` updated in the same change. The
  alternative (a new profile service) fails the same test organizations-
  service passed in ADR 0013 reversed: this IS one bounded context with the
  directory users-service already serves.
- **D2 — Field definitions AND values live in users-service too.** They are
  directory data, not authorization inputs: ADR 0013's real-FK argument
  binds the authorization graph to organizations-service, and none of these
  rows decides access. Keeping definition→value as a real FK requires one
  database, and users-service already has the public face (gateway route,
  JWT) and the org-scoped projection pattern. organizations-service stays
  the authorization substrate, untouched this sprint.
- **D3 — The field model is §14's, minus what nothing reads**: stable key,
  `label_es_ar`/`label_en_us` (stored now so i18n in 10.8 is content, not
  schema churn), type, required, active, editable_by_user,
  visible_to_requester, visible_to_staff, display_order, and a per-type
  DECLARATIVE validation object (no executable logic, ever). `searchable`
  waits for something that searches. Values are one row per (field, user)
  with a text representation validated at the boundary against the
  definition — the definition builds the validator, the validator never
  runs stored code.
- **D4 — Visibility semantics, crisply**: staff-only means staff-only —
  invisible to the subject too, or the flag is a lie. The subject sees
  fields visible to requesters or editable by them; `people.read` viewers
  see staff-visible fields; `people.update` viewers see every active field,
  because editing blind is worse. Enforced server-side in one place (a
  view-filter function), not per endpoint.
- **D5 — Required never blocks authentication or tickets.** It is enforced
  at write time (cannot clear, admin-set flows must supply) and surfaced as
  profile completeness; ADR 0017's failure mode stays impossible because no
  profile field is a credential.
- **D6 — `profile.updated.v1` carries changed keys, never values.** Values
  in an event would sit in the audit trail's jsonb forever (the retention
  note in data-ownership.md); keys-only matches the ai-suggestion
  precedent. The event is NOT tenant-carrying by name: a person-level edit
  can legitimately happen with no organization (the belongs-nowhere state
  edits their own phone), so the envelope carries the org when the actor
  has one, and the audit trail records the rest with null — exactly the
  user.registered.v1 shape.
- **D7 — Permissions from the approved matrix, first call sites**:
  `organization.update` gates field-definition management;
  `people.update` gates editing someone else's values. Both keys join the
  vocabulary with real call sites; owner and organization_admin gain them
  in the code map (matrix ● cells; branch_manager's ○ people.update stays
  unrepresented until branch-scoped editing means something).

### Security boundaries

- Staff-only values are the leak surface: one server-side filter, pinned by
  adversarial tests including the subject's own view.
- Values and definitions are organization-owned rows: every read and write
  requires the tenant from the token; a foreign user or field answers 404.
- Validation objects are data with a closed schema per type — nothing
  evaluates stored expressions.
- A profile edit can never become a credential change (ADR 0017): email is
  not editable here, and no field participates in login.
- Events carry keys, not values.

### Migration impact

Additive only: person-level nullable columns on `user_profiles`, two new
tables (`organization_profile_fields`, `profile_field_values`) with real
FKs inside `helpdesk_users`. No backfill; no NOT NULL. Rollback is a code
revert plus dropping empty tables — except self-edits made in between,
which is precisely why ADR 0018 exists.

### Test strategy

Unit matrices per type and per visibility cell (fakes enforcing org scope,
R2); integration against real PostgreSQL for definitions, values, the
directory join and the visibility filter, by identity, two organizations
throughout; the metadata-only event pinned at unit level; full gate plus
all nine suites before push.

### Explicitly out of scope

Profile images/avatars (file upload needs the storage and upload-validation
design SECURITY.md already lists as unbuilt — its own increment); CSV
import (9.9); people-management UI (Block B); email-optional accounts (ADR
0017 calls it a sprint of its own); organization-scoped login identifiers
(ADR 0017, separate credential design); `searchable`; department-membership
display; any change to organizations-service beyond the permission map.

### Ready?

Dependency complete, state known, criteria and strategy above, the one
structural decision has its ADR, everything is additive and reversible.
Proceeding under the standing autonomous authorization.

## Outcome record (2026-08-01)

Every acceptance criterion landed in two commits: the opening (`8384b5a` —
DoR, ADR 0018, vocabulary keys, code-map grants, the metadata-only
contract) and the implementation (`4614523`).

**The two-organizations story holds.** Org A defines a required
employee_number with a `^[0-9]{4}$` pattern: a wrong shape is refused, a
correct one lands and announces `changedKeys: ['employee_number']` with no
value in the event, and clearing it is refused. Org B configures nothing
and its profiles are exactly yesterday's. The walk is pinned at the
use-case level and the visibility and validation matrices at the domain
level.

**Staff-only does not leak, not even by implication.** The one view-filter
decides every response; a subject asking to WRITE a staff-only key gets
not-found rather than forbidden, because a 403 would confirm the key
exists. The hybrid-table invariant is enforced twice: the registration
consumer's upsert update-arm is restricted to identity columns — a test
proves a replayed registration cannot undo a rename even when the test
tries to rename through the seed path and fails, which is the restriction
working.

### What the implementation decided that the DoR had left open

- **A visible-but-not-editable field refuses with 403; an invisible one
  with 404** — the same existence-hiding discipline tickets uses, applied
  one level down.
- **Clearing an unset value is a no-op and announces nothing**; an event
  that says nothing changed is a bug at the publisher.
- **Key AND type are immutable** — the DoR promised the key; the
  implementation extended it to the type, because retyping a field orphans
  the semantics of every stored value, and a changed type in a PATCH is a
  409 conflict with the row's identity, not a malformed request.

### Verified

users-service: 53 unit tests across 7 suites (validation matrix per type,
visibility cell matrix, the acceptance walk, event metadata pinned,
hybrid-table replay protection), integration green with the migration
applied to a populated database. The full gate plus all nine integration
suites ran green locally, and remotely GitHub Actions run `30681958652` on
`42b0456` was green on its first attempt.

## Documentation

Meaningfully changed this sprint: ADR 0018 (new — the ownership decision
and its stated cost), `data-ownership.md` (user_profiles' rebuild row tells
the truth about the hybrid; the non-rebuildable category gained its second
member), this document, and the handoff. No fictional experience,
customers, incidents or approvals were introduced.
