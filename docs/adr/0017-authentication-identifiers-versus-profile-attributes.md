# ADR 0017 — Authentication identifiers versus profile attributes

- Status: Accepted (approved 2026-07-30)
- Date: 2026-07-30
- Sprint: 9.1 (Product domain and tenancy audit)

## Context

Email is currently the only way to be a person in this system, and it is
load-bearing in more places than I expected before auditing it:

- **Authentication.** `LoginUseCase` looks up solely by email
  (`apps/auth-service/src/application/use-cases/login.ts:21`), and both DTOs
  mandate a valid one (`login.dto.ts:6`, `register.dto.ts:6-7`).
- **Uniqueness.** Globally unique in `helpdesk_auth.users`, and globally
  unique again in the `helpdesk_users.user_profiles` projection. Those are the
  only two constraints in the platform that tenancy might touch at all.
- **Identity on the wire.** `user.registered.v1` carries it, so it is in the
  audit trail's raw payloads.
- **Display.** The avatar initial, the account menu label and the account
  page all read it (`apps/web/src/components/app-shell.tsx:56,59`), and it
  seeds the projected display name in users-service.

The product needs to serve people who have no corporate email: a cashier with
an employee number, a warehouse worker with an internal username, someone
identified by name and branch. The temptation is obvious — the profile
already has an employee number field in the target model, so let people log
in with it.

## Decision

**An authentication identifier and a profile attribute are different things,
and the model must not let one become the other by accident.**

|                  | Authentication identifier                 | Profile attribute                     |
| ---------------- | ----------------------------------------- | ------------------------------------- |
| Purpose          | Proves who you are                        | Describes who you are                 |
| Uniqueness       | Enforced, within a defined scope          | Not necessarily unique                |
| Editable by user | No                                        | Often yes                             |
| Changing it      | A credential operation: audited, verified | An ordinary profile edit              |
| Owner            | auth-service                              | organizations-service / users-service |

Concretely: **employee number is a profile attribute and must not become a
login credential by virtue of being unique-looking.** If an organization wants
employee-number sign-in, that is a separate, deliberately designed credential
type — an organization-scoped login identifier that lives in auth-service,
carries its own uniqueness rule, its own recovery path and its own audit
events.

The failure mode this prevents is specific and worth naming. If the employee
number is both a profile field an admin can edit and the thing you log in
with, then editing a profile is silently a credential operation: an admin
who corrects a typo in someone's employee number has changed their username,
possibly onto a value someone else logs in with. Recovery, audit and
uniqueness all quietly become the profile editor's problem.

**Nothing here is implemented in this sprint.** What this ADR fixes is the
boundary, so that Sprint 9.6 (profiles) cannot accidentally ship a credential.

### The identity model this implies

**One human, one account, platform-wide.** The globally unique email already
forces this and I am keeping it rather than fighting it: making
`users(email)` composite with an organization would mean the same person has
two passwords, two sessions and two password-reset flows for two employers.
Membership is the right way to express "belongs to two organizations"
(ADR 0013), and it is the reason `users` and `refresh_tokens` stay global
while the other ten tables become organization-owned (ADR 0012).

**Email becomes optional at the account level, eventually.** That is the
change that unlocks the no-corporate-email case, and it is a real migration:
`email` is `NOT NULL` and unique in two databases, it is in an event
contract, and the UI treats it as a non-null display attribute in four
places. It is not a column change; it is a sprint.

**Display identity is not authentication identity.** The UI should render a
display name, not an email address. Today it renders the email as the avatar
initial and the menu label, which means a user with no email has no name on
screen. Fixing that is cheap and independent of everything else here, and it
should happen before employee-number identity is attempted rather than as
part of it.

## What I would revisit before production

Whether organization-scoped login identifiers are worth building at all, or
whether SSO makes them unnecessary. A company large enough to have employees
without email is often large enough to have a directory, and
`§15` already plans Entra ID and Google Workspace. If SSO arrives first, the
employee-number credential may never need to exist — the identity comes from
the directory and the employee number stays a profile attribute, which is
where this ADR wants it anyway.

I am recording that as an open question rather than a decision, because it
depends on which customer shows up first and I do not have one.

## Consequences

Positive:

- A profile edit can never become a credential change.
- One account per human keeps sessions, password reset and reuse detection
  exactly as they are — machinery that already works and is well tested.
- The no-email case has a defined path instead of an accidental one.

Negative / accepted:

- Making email optional is a multi-database migration touching a contract and
  the UI. It is deferred, and until it lands, every user needs an email.
- Organization-scoped login identifiers, if built, mean login needs an
  organization context _before_ authentication — a different flow from
  today's, and one that leaks which organizations exist unless designed
  carefully.

## Related

ADR 0013 keeps identity in auth-service and membership in
organizations-service. ADR 0012 explains why `users` stays global.
