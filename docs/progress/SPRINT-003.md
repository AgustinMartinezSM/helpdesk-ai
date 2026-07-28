# Sprint 3 — End-to-End Login Path

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-28.

## Goal

Make the target request path real for the first user-facing capability: `web -> web-bff -> api-gateway -> auth-service`, with browser-grade session handling.

## Scope completed

- **api-gateway**: `/api/auth/*` proxied to auth-service (`http-proxy-middleware` 3.0.7 — v4 is ESM-only and unusable from the CJS bundle; version verified online). Root-mounted with `pathFilter` (Express strips mount paths from `req.url`), `fixRequestBody` for the body-parser conflict, correlation ids forwarded downstream. `AUTH_SERVICE_URL` in validated env.
- **web-bff**: `/session/login|refresh|logout` + `/session/me`. The refresh token lives only in an httpOnly `SameSite=Lax` cookie scoped to `/session`; browser JavaScript receives the access token alone. Upstream calls use Node 24 native fetch with per-request timeouts (verified production-ready); unreachable platform maps to 502. CORS with credentials against the explicit web origin. ValidationPipe now active.
- **web**: `AuthProvider` with silent refresh on mount (page reload deliberately drops the in-memory access token and recovers via cookie), `/login` and `/account` pages wired to the BFF.

## Validation results

| Check                                             | Result                                                                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace gate (format/lint/test/build/typecheck) | All passing, 6 projects                                                                                                                                                                           |
| New fast tests                                    | Gateway proxy 4 (stub upstream), BFF sessions 11 (stub gateway + cookie util), web 4 (login flow, silent refresh) — total suite now 53 fast + 6 integration                                       |
| Full-chain runtime E2E (production bundles)       | register via gateway proxy; login via BFF (cookie set, refresh token **absent** from body); `/session/me` across all three services; refresh via cookie only; logout 204; post-logout refresh 401 |
| CI workflow on GitHub                             | **NOT VERIFIED** — still no remote                                                                                                                                                                |

## Findings

- http-proxy-middleware v3 rewrites against the mount-relative `req.url`; mounting at the root with `pathFilter` is the working pattern (caught by the stub-upstream test before runtime).
- Registration currently enters through the gateway directly; the BFF/web signup experience is deliberately deferred.

## Intentionally deferred

Signup UI, password reset, gateway rate limiting, users/tickets domains, push to remote.
