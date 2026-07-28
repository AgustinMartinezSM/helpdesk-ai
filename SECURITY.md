# Security Policy

This document describes the security posture of HelpDesk AI at its current stage (Sprint 2: authentication implemented in auth-service; no other domain features). It distinguishes what is implemented today from what is planned.

## Reporting a Vulnerability

The repository currently has no remote and no public issue tracker. Until one exists:

- Report suspected vulnerabilities directly to the project maintainer through a private channel. Do not disclose details publicly.

Once the repository is pushed to a remote with an issue tracker:

- Open a security advisory or private issue (do not file a public issue with exploit details).
- Include reproduction steps, affected component (app or library), and impact assessment.

Do not test vulnerabilities against anything other than a local development environment.

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
- **Database ownership**: auth-service connects to `helpdesk_auth` with its own `auth_service` role; admin credentials are separate. No cross-service database access exists (ADR 0003).
- **Dependency build-script allow-list**: pnpm 11 blocks lifecycle scripts by default; only an explicit allow-list may build (`@parcel/watcher`, `@prisma/client`, `@prisma/engines`, `@swc/core`, `argon2`, `nx`, `prisma`, `sharp`, `unrs-resolver`). The `@scarf/scarf` install telemetry is deliberately blocked.

## Planned Security Roadmap

None of the following is implemented. Do not assume any of it exists when assessing the current codebase.

- **Authorization enforcement**: RBAC/permission checks on domain resources (the roles claim exists; nothing consumes it yet beyond `/auth/me`).
- **Password reset and email verification** flows.
- **Session management** (list/revoke own sessions).
- **Upload validation** (file type, size, content checks) when file handling is introduced.
- **Dependency audit in CI** (e.g. `pnpm audit`) once the workflow runs against a remote.
- **Rate limiting** on the gateway and BFF once they expose business endpoints.

## Scope Notes

- The attack surface is limited to local HTTP services and local-only infrastructure containers. Nothing is exposed beyond localhost, and the repository has no remote.
- Infrastructure containers (PostgreSQL 18, Redis 8 with `requirepass`, RabbitMQ 4.3) are development-only and not hardened for external exposure.
- The CI workflow has never executed (no remote); treat its security posture as unverified until the first real run.
