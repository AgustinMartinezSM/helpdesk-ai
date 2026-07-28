# Sprint 2 — Authentication Foundation

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-28.

## Goal

Deliver real authentication in auth-service under the clean-architecture rules: registration, login, rotating refresh sessions with reuse detection, and the first service-owned database — with the persistence tooling decision made explicitly (ADR 0004) before the first line of persistence code.

## Scope completed

- **ADR 0004 accepted**: Prisma 7 for domain-service persistence, behind repository adapters. Versions verified online against official sources on the day of implementation (Prisma 7.9.1, argon2 0.45.1, @nestjs/jwt 11.0.2, @nestjs/swagger 11.4.6, @nestjs/throttler 6.5.0, class-validator 0.15.1).
- **Database provisioning**: `infrastructure/postgres/init` creates the `auth_service` role and the `helpdesk_auth` / `helpdesk_auth_test` databases on first volume initialization (ADR 0003: exclusive ownership, separate credentials). `CREATEDB` on the role is local-only, for Prisma's shadow database.
- **auth-service layers**:
  - `domain/`: `User` (normalized email, argon2id PHC hash, roles) and `RefreshToken` (sha256 of the secret half only); client-safe domain errors.
  - `application/`: ports (`UserRepository`, `RefreshTokenRepository`, `PasswordHasher`, `TokenIssuer`, `Clock`), a refresh-token codec (opaque `<id>.<secret>`, constant-time hash comparison), `SessionService`, and use cases `RegisterUser`, `Login`, `RefreshSession`, `Logout`. No framework imports anywhere in these layers.
  - `infrastructure/`: Prisma 7 with the pg driver adapter (lazy connection so liveness is database-independent), `PrismaUserRepository` (maps unique-violation races to the domain error), `PrismaRefreshTokenRepository` (first revocation timestamp wins), argon2id hasher (OWASP interactive-login parameters), JWT issuer.
  - `presentation/`: `/auth/register|login|refresh|logout|me`, class-validator DTOs under a global `ValidationPipe` (whitelist + forbidNonWhitelisted), a domain-error filter (409/401), JWT guard, per-route throttling (5/min credentials, 20/min refresh), Swagger UI at `/docs` outside production.
- **Security behavior**: refresh rotation links replacements; reuse of a rotated token revokes every session of the user; unknown-email logins burn hash time against enumeration timing; security events logged without emails or passwords.
- **Readiness with truth**: `/health/ready` now probes `helpdesk_auth` and answers 503 when it is down.
- **Tests**: 42 fast tests across the workspace (23 in auth-service: use cases, codec, HTTP with in-memory fakes, validation 400s, throttling 429) plus 6 integration tests (`*.int.spec.ts`) against `helpdesk_auth_test` through the `test-integration` target — repository adapters and the full HTTP flow with real argon2, JWT and Prisma.
- **CI**: postgres:18 service container, explicit provisioning step, and the integration-test run added to the workflow.

## Validation results

| Check                                                | Result                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `format:check`, `lint`, `test`, `build`, `typecheck` | All passing (6 projects)                                                                            |
| Unit + fast HTTP tests                               | 42 passing, Docker-free                                                                             |
| Integration tests (real PostgreSQL)                  | 6 passing against `helpdesk_auth_test` (migrations applied by the target)                           |
| Prisma migration                                     | `20260728040346_init` created and applied to `helpdesk_auth`; deploy verified against the test DB   |
| End-to-end on the production bundle                  | register → login → me → refresh (rotated) → replay (401, family revoked) → logout (204); Swagger UI |
| Readiness probe                                      | 200 with database up; 503 with `database: down` verified in tests                                   |
| Fail-fast config                                     | Boot refused without `JWT_ACCESS_SECRET`/`DATABASE_URL` (schema validation)                         |
| CI workflow on GitHub                                | **NOT VERIFIED** — the repository still has no remote; the workflow has never run                   |

Containers were shut down after validation; the native PostgreSQL 16 on 5432 was never touched.

## Deviations and findings

- **Prisma 7 architecture**: the datasource `url` is no longer allowed in `schema.prisma`; it moved to `prisma.config.ts`, and the client requires the pg driver adapter (`@prisma/adapter-pg`). The research flagged the generator change; the config placement surfaced during implementation.
- **argon2 typings**: 0.45 no longer exports the `Options` type; options are passed inline so overload resolution picks the string-returning hash.
- **Webpack + native modules**: the Nx webpack plugin inlined argon2's native loader, which cannot resolve prebuilt binaries from `dist`. Fixed by appending an `externals` entry after the plugin configures the compiler (it overwrites root-level `externals`). Documented in the local development guide.
- **Nx project-graph staleness**: `externalDependencies: 'all'` externalizes based on the project graph, which did not reflect newly added dependencies until `nx reset`.
- **jest preset conflict**: the Nx preset sets `testMatch`, so the integration config must override `testMatch` rather than add `testRegex`.

## Intentionally deferred

- Gateway → auth-service routing and the BFF login flow (next increment; the web application still has no way to reach auth).
- Password reset, email verification, session listing/revocation UI.
- RBAC enforcement beyond the roles claim.
- Push to remote / first CI run.

## Risks

- **CI unproven**: the workflow now includes a service container and provisioning step that have never executed. First push remains a real task.
- **Prisma 7 recency**: 7.9.1 was released the day before implementation; the `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml` record that this recency was accepted knowingly.
- **Single JWT secret**: HS256 with one shared secret is fine while auth-service is the only verifier; moving verification to the gateway will motivate asymmetric keys (future ADR).
