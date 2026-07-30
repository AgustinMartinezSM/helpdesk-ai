# Security Policy

This document describes the security posture of HelpDesk AI at its current stage (sprints 1–7.6 complete: authentication, the ticket domain, and the audit, notification and analytics services). It distinguishes what is implemented today from what is planned.

## Reporting a Vulnerability

The repository lives at https://github.com/AgustinMartinezSM/helpdesk-ai.

- Open a private security advisory through GitHub (**Security → Advisories → Report a vulnerability**). Do not file a public issue with exploit details.
- Include reproduction steps, affected component (app or library), and impact assessment.

Do not test vulnerabilities against anything other than a local development environment. There is no deployment: nothing of this project is hosted.

## Secrets Policy

- No secrets are committed to the repository. Real `.env` files are git-ignored.
- Each service ships an `.env.example`; the root `.env.example` holds only compose infrastructure overrides.
- `JWT_ACCESS_SECRET` has **no default**: auth-service refuses to boot without a secret of at least 32 characters. The `.env.example` value is a placeholder that fails nothing silently — you must replace it.
- Example infrastructure credentials (e.g. `helpdesk_admin` / `helpdesk_local_only_pg`, `auth_service` / `helpdesk_local_only_auth`) are non-default and local-only, overridable via a git-ignored `.env`.
- The CI workflow uses no repository secrets; its database credentials exist only inside a throwaway service container.

## Authentication (Implemented — auth-service)

- **Password hashing**: argon2id with OWASP Password Storage Cheat Sheet parameters for interactive logins (19 MiB memory, t=2, p=1). Hashes are PHC strings, so parameters can be raised without invalidating existing hashes.
- **Access tokens**: JWT signed with `JWT_ACCESS_SECRET`, 15-minute default TTL, issuer claim, roles embedded.
- **Refresh tokens**: opaque `<id>.<secret>` credentials. Only sha256(secret) is stored — a database leak yields no usable refresh tokens. Tokens rotate on every use.
- **Reuse detection**: presenting an already-rotated refresh token is treated as theft — every session of that user is revoked immediately.
- **Account-enumeration resistance**: login failures return an identical 401 body for unknown email and wrong password, and unknown-email attempts burn comparable hashing time so response timing does not reveal account existence.
- **Brute-force mitigation**: per-IP throttling on credential endpoints (5/min on register and login, 20/min on refresh) returning 429.
- **DTO validation**: global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform` — unknown fields are rejected, not stripped.
- **Security events**: registrations, login successes/failures and refresh-reuse detections are logged as structured events with user ids only — never emails or passwords.

## Platform Hardening (Implemented)

- **helmet** on all NestJS applications.
- **Restrictive CORS on the BFF** (`http://localhost:3000` by default via `CORS_ALLOWED_ORIGINS`); **CORS disabled** on api-gateway and auth-service — browsers never call them, server-to-server only.
- **Log hygiene** (`libs/observability`): minimal serializers keep headers and bodies out of logs; redact list (`authorization`, `cookie`, `set-cookie`) as safety net. Structured JSON only.
- **Fail-fast configuration validation** (`libs/configuration`): invalid configuration exits the process before the framework wires anything, reporting every offending variable.
- **Authorization enforcement**: the roles claim is consumed by guards inside each service, not only by `/auth/me`. Ticket assignment is staff-only, analytics summaries are staff-only, the audit trail is admin-only, and requesters may close only their own resolved tickets. `libs/security` holds the shared actor model and role helpers.
- **Database ownership**: every service connects to its own database with its own role (`helpdesk_auth`, `helpdesk_tickets`, `helpdesk_users`, `helpdesk_audit`, `helpdesk_notifications`, `helpdesk_analytics`, `helpdesk_ai`); admin credentials are separate. No cross-service database access exists (ADR 0003).
- **AI data flow** (`ai-service`, ADR 0010 / ADR 0011): the service holds **no credential of its own** for the ticket store — it forwards the caller's access token, so it can never read a ticket the caller could not. Its endpoints are staff-only. **Internal notes are removed** before any context leaves the process, and the context is truncated to fixed limits. **No ticket text is persisted**: a stored suggestion keeps the model's output plus a SHA-256 hash of the context. Provider output is validated against a per-task schema before it is stored, so a remote model cannot decide what shape this platform's data takes. The published event carries metadata only, never content. With the local provider selected, no data leaves the machine at all.
- **Dependency build-script allow-list**: pnpm 11 blocks lifecycle scripts by default; only an explicit allow-list may build (`@parcel/watcher`, `@prisma/client`, `@prisma/engines`, `@swc/core`, `argon2`, `nx`, `prisma`, `sharp`, `unrs-resolver`). The `@scarf/scarf` install telemetry is deliberately blocked.

## Planned Security Roadmap

None of the following is implemented. Do not assume any of it exists when assessing the current codebase.

- **Password reset and email verification** flows.
- **Session management** (list/revoke own sessions).
- **Upload validation** (file type, size, content checks) when file handling is introduced.
- **Dependency audit in CI** (e.g. `pnpm audit`) — now that the workflow runs on a remote, this is an open task rather than a blocked one.
- **Rate limiting** on the gateway and BFF, which throttle nothing today; only auth-service's credential endpoints are throttled. This matters more now that `ai-service` exists: with a paid provider connected, an unthrottled staff account is a spending path as well as a load path.
- **Provider credential handling** for a paid model provider: no key exists yet, so nothing about rotation, scoping or per-request budgets has been designed. It must be part of connecting one (ADR 0010).

## Scope Notes

- The attack surface is limited to local HTTP services and local-only infrastructure containers. Nothing is exposed beyond localhost: the source is public on GitHub, but no environment of this project is deployed.
- Infrastructure containers (PostgreSQL 18, Redis 8 with `requirepass`, RabbitMQ 4.3) are development-only and not hardened for external exposure.
- The CI workflow now runs on GitHub Actions and passed on its first remote execution, including the integration suites against real service containers.
