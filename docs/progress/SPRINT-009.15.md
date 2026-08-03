# Sprint 9.15 — Bulk employee onboarding by CSV

Status: **Open (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 9.14 is merged with remote CI green
(run `30791213751` on `3aa7070`, first attempt). `main` equals `origin/main` at
`59e0a7c`, working tree clean.

**The identifier comes from the repository**, not from the plan: the last
sprint document is `SPRINT-009.14.md`, so this is 9.15.
`docs/roadmap/PRODUCT-ROADMAP.md` still does not exist — `SPRINT-009.0.md`
declined to create it on the grounds that publishing a forward plan is a
product decision rather than a documentation chore, and the handoff's "Exact
next action" has carried that role since. It names bulk/CSV import first, with
the reason 9.14 added: _"one derivation answers which role templates it may
write; do not build a second one."_

### What the repository already has, and what it does not

- **Invitations are the only way a person joins.** `password_hash` is
  `TEXT NOT NULL`, ADR 0016 forbids a placeholder hash, and 9.8 recorded that
  "there are no admin-created accounts, and that is decided, not pending". An
  import therefore issues **access**, never accounts.
- **The grant ceiling is settled and centralized** (9.14):
  `isOrganizationGrantable` for what an organization may grant at all, and
  `canGrantRoleTemplate(issuerStoredTemplate, requested)` for what this actor
  may. Both read from `@helpdesk-ai/security` and the issuer's **stored**
  membership. This sprint adds no list of its own.
- **`people.import` is in the approved matrix (● owner, ● organization_admin)
  and in no code.** It has no call site, exactly as `teams.manage` had none
  before 9.12. This sprint is that call site.
- **The invitation carries an email and a role template, and nothing else.**
  No branch, no department. Sprint 9.8 wrote that branch_manager's `○` on
  `people.invite` "would have to mean 'into my branches', which needs the
  branch set on the invitation itself — a shape this sprint does not build".
- **`Department.branchId` is a required foreign key** and
  `@@unique([branchId, name])`. `BranchMembership` and `DepartmentMembership`
  both exist as joins. Redemption already inserts the membership and consumes
  the code in ONE transaction.
- **`DuplicatePendingInvitationError` exists**, raised by a partial unique
  index (`WHERE status = 'pending'`) rather than a prior read. That is the
  idempotency mechanism this sprint needs, already built.

### Product objective

An administrator onboards a whole team from a spreadsheet: download a template,
fill it, upload it, **see exactly what would happen before anything happens**,
then apply it. Every row that cannot be applied says why, in a file they can
fix and re-upload. Running the same file twice changes nothing the second time.

### User stories and acceptance criteria

1. **The administrator starts from a file the product gave them.** Done when a
   template is downloadable, its columns are the schema, and the roles it can
   name are the ones the server would accept from _that_ administrator.
2. **Nothing is written until they say so.** Done when preview reports per-row
   outcomes and writes nothing, and when apply re-validates rather than
   trusting the preview.
3. **A bad row is named, not guessed at.** Done when each failure carries the
   row number, the offending value and a reason, and when the failures come
   back as a CSV the administrator can fix and re-upload.
4. **A misspelling never creates anything.** Done when an unmatched branch,
   department or role is a row error naming the value — never a new branch, a
   new department, a new team or a new template.
5. **A department belongs to its branch.** Done when a department named without
   a branch is refused, and a department belonging to another branch is
   refused, with different messages.
6. **Privilege cannot escalate through a spreadsheet.** Done when `owner` is
   refused, when a platform-scoped template would be refused by construction,
   and when an actor cannot import a role their own stored template could not
   grant.
7. **Running it twice is safe.** Done when a second run of the same file
   reports every row as already invited or already a member and writes nothing.
8. **One organization's import cannot touch another's people or structure.**
   Done when the tenant comes from the token, and when a branch or department
   of another organization resolves as not found rather than as a match.

### Technical scope (decisions D1–D12)

- **D1 — The import issues invitations. It creates no accounts, and it sends
  nothing.** ADR 0016 and ADR 0008 between them decide this: the admin creates
  ACCESS, the person creates the account, and delivery is out of band. A file
  of 200 employees produces 200 codes an administrator has to pass on
  themselves. **That is a real ergonomic cost and it is stated rather than
  designed around** — email delivery is what fixes it, and ADR 0008 leaves
  adopting a provider to the project owner. The screen says so out loud, the
  way the single-invitation form already does.
- **D2 — Preview and apply are two calls over the same payload, and the file
  is sent twice.** Rejected: parking the parsed batch server-side between them.
  That is a job table, an expiry rule and a cleanup story for a form that takes
  seconds, and it would make the preview authoritative — apply re-parses and
  re-validates everything, so a file edited between the two cannot smuggle a
  row past a preview that approved a different one.
- **D3 — The CSV arrives as text in a JSON field, not as multipart.**
  `GatewayClient` speaks JSON over GET/POST/PATCH; multipart would be a new
  transport through three processes for a payload measured in kilobytes. Capped
  at 500 rows and 64 000 characters, comfortably inside the default body limit,
  and refused above either.
- **D4 — Four columns, and an unknown header refuses the whole file.**
  `email` (required), `role`, `branch`, `department` (optional). A header row is
  required. Refusing the file on an unknown column is the same discipline as
  `forbidNonWhitelisted`: a misspelled header that silently drops a column is
  how every row gets the wrong role.
- **D5 — Names, not identifiers, and resolution is exact.** An administrator
  filling a spreadsheet knows "Store 12" and "Electronics", not UUIDs.
  Resolution trims and compares exactly, case-insensitively, against the
  caller's organization. **No fuzzy matching and no creation** — an unmatched
  value is a row error that quotes it back.
- **D6 — The role column takes the STABLE KEY.** `service_desk_manager`, not
  "Service desk manager". Display labels are localizable (9.14, D7), so a file
  written against them would break the day they are translated. The template
  the product hands out is pre-filled with the keys this actor may grant, so
  nobody has to know them.
- **D7 — The invitation gains `branch_id` and `department_id`**, nullable, with
  foreign keys, applied at redemption inside the transaction that already
  inserts the membership. Validating a branch in the CSV and then discarding it
  would be theatre. This also retires the note 9.8 left about the branch set
  needing to live on the invitation.
- **D8 — Every row is its own unit; there is no batch transaction.** Row 499
  failing must not undo 498 good invitations, and the recovery path is fixing
  the failed rows and re-uploading. Semantics stated plainly: **partial
  application, no rollback, safe to re-run.**
- **D9 — Idempotency is the partial unique index and the membership check,
  not a new mechanism.** A pending invitation for that address reports
  `already_invited`; an active membership reports `already_member`. Both are
  skips, not errors. A second run of the same file writes nothing.
- **D10 — `people.import` gets its first call site**, granted to `owner` and
  `organization_admin` only, matching the matrix. The row-level role check is
  the 9.14 derivation and nothing else; a caller who holds `people.import` but
  whose stored template cannot grant `agent` still cannot import one.
- **D11 — Two kinds of audit record.** Each issued invitation already publishes
  `invitation.issued.v1`, which the audit firehose stores, so what was created
  is already attributable. One new `people.import.completed.v1` carries the
  actor, the counts and the outcome — **never the rows, never an address, never
  a code**. It says "this batch happened" without copying personal data into a
  second store.
- **D12 — The error report is generated in the browser** from the response the
  server already returned. No temporary files, no storage, nothing to expire.

### Security boundaries

- **The tenant comes from the token**, and every lookup — branches,
  departments, memberships, invitations — is organization-scoped at the port.
  A foreign branch resolves as not found, identically to a misspelling.
- **Privilege cannot travel upward through a file.** The same two functions the
  invite form and the role editor call, against the same stored membership.
  `owner` is refused by constant; a platform-scoped template is refused by the
  scope derivation. Both get a test that goes through the import path rather
  than assuming the shared function is enough.
- **No code reaches a log, an event or the error report.** The response carries
  each issued code exactly once, as the single-invitation endpoint does, and
  the error report contains only failed rows — which by definition have none.
- **The preview writes nothing.** Asserted by a test that counts rows before
  and after, not by reading the code.
- **A suspended or deactivated importer is refused**, from the stored row, as
  every other administration path already does.

### Migration impact

**One migration, additive and nullable**: `invitations.branch_id` and
`invitations.department_id`, both with foreign keys inside the same database
(ADR 0013 is what makes that enforceable). No backfill, no data movement, no
column dropped or rewritten. Every existing invitation keeps working with both
null, which is exactly what the single-invitation form will keep producing.
Rollback is a code revert plus a forward migration, the shape every additive
migration has taken since phase 4.

### Test strategy

The eight acceptance criteria, each named in its test. Beside them: the parser
against a file with a byte-order mark, CRLF endings, quoted fields containing
commas, blank lines and trailing whitespace; duplicate addresses inside one
file, differing only by case; an unknown header refusing the file; a
department named without a branch and a department from another branch, as
different messages; a preview that writes nothing; a re-run that changes
nothing; a foreign branch resolving as not found; and the two privilege
refusals through the import path.

Full gate plus all nine integration suites before push, then remote CI. A
browser pass over the download, preview and apply, since D2's whole point is
that a person sees what will happen before it does.

### Explicitly out of scope

Account creation (D1). Email delivery — still ADR 0008 and the project owner's.
Asynchronous or scheduled imports: this is a synchronous request with a row
cap, and a queue is what a file too big for one deserves. XLSX. Import of
anything but people — branches, departments and teams are created on their own
screens, on purpose. Automatic routing rules, custom roles, branding, the Helpi
redesign, WhatsApp, billing, SSO and SCIM.

**Carried forward as hardening debt, not blocking this sprint**: the projection
cold-start finding from 9.15's pre-work — a durable queue that did not exist
when events were published means a consumer starts empty and only fills from
the next event. The import path does not read any projection: branches and
departments are resolved inside organizations-service against its own tables,
which are the source of truth rather than a copy. Recorded in the handoff and
in "Validación integral" below.

### Ready?

The vocabulary this sprint would have been dangerous without was settled last
sprint, which is why it was done first. One additive migration. The riskiest
property — that a spreadsheet cannot escalate privilege or invent structure —
is expressed as refusals in existing, tested functions rather than as new
rules. Proceeding under the standing autonomous authorization.
