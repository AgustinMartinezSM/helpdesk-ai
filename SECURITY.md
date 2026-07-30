# Security Policy

This document describes the security posture of HelpDesk AI at its current stage (sprints 1–9.0 complete: authentication, the ticket domain, the audit, notification and analytics services, and the AI service with a connected model provider). It distinguishes what is implemented today from what is planned.

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
- `GEMINI_API_KEY` is the one third-party credential in the platform. It ships empty in `apps/ai-service/.env.example`, is required only when `AI_PROVIDER=gemini` (startup fails fast naming the variable), and travels as an `x-goog-api-key` header, never in a URL. Redirects are refused, because a custom header — unlike `authorization` — is forwarded to the redirect target. A real value belongs only in the git-ignored `apps/ai-service/.env`.
- **Error redaction is a single boundary** (`ai-service`, `domain/redaction.ts`): every AI domain error redacts its own message in the abstract base constructor, so nothing constructed anywhere in the service can carry a credential to the HTTP body, the log serializer or a stack. Two layers run there — exact configured values, and patterns for Google API keys, OAuth tokens, `x-goog-api-key`, `authorization`, `Bearer` tokens, `GEMINI_API_KEY=` assignments and credential-bearing query strings. The pattern layer covers paths that never hold the key, such as the application layer re-wrapping a transport error whose nested `cause` echoes the request. Labels are kept and only values replaced, so a redacted message still explains the failure.
- The CI workflow uses no repository secrets; its database credentials exist only inside a throwaway service container. It never sets `AI_PROVIDER`, so the schema default (`local`) applies and no model-provider key is needed to run the full suite. That default is what keeps CI credential-free — changing it would make every pipeline demand a key.

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
- **AI data flow** (`ai-service`, ADR 0010 / ADR 0011): the service holds **no credential for the ticket store** — it forwards the caller's access token, so it can never read a ticket the caller could not. Its endpoints are staff-only. **Internal notes are removed** before any context leaves the process, and the context is truncated to fixed limits. **No ticket text is persisted**: a stored suggestion keeps the model's output plus a SHA-256 hash of the context. Provider output is validated against a per-task schema before it is stored, so a remote model cannot decide what shape this platform's data takes. The published event carries metadata only, never content.

  **Where the text goes depends on the configured provider.** With `AI_PROVIDER=local`, nothing leaves the machine at all. With `AI_PROVIDER=gemini`, the ticket title, description, public thread, status, priority and category are sent to Google to be processed under the Gemini API terms. Internal notes are excluded in both cases — they are dropped before a provider context object exists, which was verified as behavior: adding an internal note leaves the stored `contextHash` byte-identical, while adding a public reply changes it. The model-provider credential (`GEMINI_API_KEY`) is separate from ticket authorization and grants no access to any ticket.

- **Dependency build-script allow-list**: pnpm 11 blocks lifecycle scripts by default; only an explicit allow-list may build (`@parcel/watcher`, `@prisma/client`, `@prisma/engines`, `@swc/core`, `argon2`, `nx`, `prisma`, `sharp`, `unrs-resolver`). The `@scarf/scarf` install telemetry is deliberately blocked.

## Planned Security Roadmap

None of the following is implemented. Do not assume any of it exists when assessing the current codebase.

- **Password reset and email verification** flows.
- **Session management** (list/revoke own sessions).
- **Upload validation** (file type, size, content checks) when file handling is introduced.
- **Dependency audit in CI** (e.g. `pnpm audit`) — now that the workflow runs on a remote, this is an open task rather than a blocked one.
- **Rate limiting** on the gateway and BFF, which throttle nothing today; only auth-service's credential endpoints are throttled. This is no longer hypothetical: a remote provider is connected, so an unthrottled staff account is a spending path as well as a load path. Even on a free tier the exposure is real — exhausting the quota takes the feature down for everyone, and the service surfaces that as a 503.
- **Provider credential lifecycle**: the key is required-only-when-selected, header-only and redacted from errors (see Secrets Policy), but **rotation, scoping and per-request or monthly budget ceilings are not designed or built**. These are what stand between the AI capabilities being API ready and being safe to deploy publicly (ADR 0009 / ADR 0010).

## Scope Notes

- The attack surface is limited to local HTTP services and local-only infrastructure containers. Nothing is exposed beyond localhost: the source is public on GitHub, but no environment of this project is deployed.
- Infrastructure containers (PostgreSQL 18, Redis 8 with `requirepass`, RabbitMQ 4.3) are development-only and not hardened for external exposure.
- The CI workflow now runs on GitHub Actions and passed on its first remote execution, including the integration suites against real service containers.
