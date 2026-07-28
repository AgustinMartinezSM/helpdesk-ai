# Security Policy

This document describes the security posture of HelpDesk AI at its current stage (Sprint 1: platform foundation only — no authentication, no business endpoints, no user data). It distinguishes what is implemented today from what is planned.

## Reporting a Vulnerability

The repository currently has no remote and no public issue tracker. Until one exists:

- Report suspected vulnerabilities directly to the project maintainer through a private channel. Do not disclose details publicly.

Once the repository is pushed to a remote with an issue tracker:

- Open a security advisory or private issue (do not file a public issue with exploit details).
- Include reproduction steps, affected component (app or library), and impact assessment.

Do not test vulnerabilities against anything other than a local development environment.

## Secrets Policy

- No secrets are committed to the repository. Real `.env` files are git-ignored.
- Each service ships an `.env.example` (`apps/web-bff`, `apps/api-gateway`); the root `.env.example` holds only compose infrastructure overrides.
- Example credentials in `compose.yaml` and `.env.example` (e.g. `helpdesk_admin` / `helpdesk_local_only_pg`) are non-default and local-only. They exist so local infrastructure does not run with image defaults; they must never be used outside a developer machine and are overridable via a git-ignored `.env`.
- The CI workflow (`.github/workflows/ci.yml`) uses no secrets.

## Current Hardening (Implemented)

- **helmet** is enabled on both NestJS applications (`apps/web-bff`, `apps/api-gateway`), setting standard security headers.
- **Restrictive CORS on the BFF**: `apps/web-bff` allows only `http://localhost:3000` by default, configured via the `CORS_ALLOWED_ORIGINS` environment variable (comma-separated).
- **CORS disabled on the gateway**: `apps/api-gateway` intentionally does not enable CORS. Browsers never call it; it is server-to-server only. Absence of CORS headers means cross-origin browser requests are rejected by default.
- **Log hygiene** (`libs/observability`): minimal serializers keep request/response headers and bodies out of logs; a redact list (`authorization`, `cookie`, `set-cookie`) acts as a safety net. Logs are structured JSON.
- **Fail-fast configuration validation** (`libs/configuration`): `validateEnv` runs before `NestFactory.create`. Invalid configuration exits the process with code 1 and reports all offending variables in a single error, so a service never starts in a misconfigured state.
- **Dependency build-script allow-list**: pnpm 11 blocks dependency lifecycle scripts by default; only an explicit allow-list in `pnpm-workspace.yaml` may build (`@parcel/watcher`, `@swc/core`, `nx`, `sharp`, `unrs-resolver`).

## Planned Security Roadmap

None of the following is implemented. Do not assume any of it exists when assessing the current codebase.

- **Authentication**: JWT access tokens with refresh token rotation (auth-service, planned).
- **Authorization**: RBAC / permission model across services.
- **Rate limiting** on public-facing endpoints (intentionally deferred; no business endpoints exist yet).
- **Brute-force mitigation** on authentication endpoints.
- **Upload validation** (file type, size, content checks) when file handling is introduced.
- **Dependency audit in CI** (e.g. `pnpm audit` or equivalent) once the workflow runs against a remote.

## Scope Notes

- There are no authenticated endpoints and no stored user data in Sprint 1; the attack surface is limited to two local HTTP services (`/health`, `/health/ready`) and local-only infrastructure containers.
- Infrastructure containers (PostgreSQL 18, Redis 8 with `requirepass`, RabbitMQ 4.3) bind to local ports and are intended for development only. They are not hardened for exposure beyond localhost.
