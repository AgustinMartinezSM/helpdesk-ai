# ADR 0002: Separate Web BFF and API Gateway as Distinct Applications

## Status

Accepted (2026-07-27, Sprint 1). Both applications exist (`apps/web-bff`, `apps/api-gateway`) with health endpoints, structured logging, and request correlation only. Neither routes to domain services yet — none exist.

## Context

The target architecture is:

```
web -> web-bff -> api-gateway -> {auth, users, tickets, ai, notification, audit, analytics}
```

Two distinct concerns sit between the frontend and future domain services:

1. **Frontend-shaped composition.** The Next.js web app needs responses shaped for its UI: aggregated calls, view-model mapping, frontend-specific caching decisions. These change at the pace of the UI, not the platform.
2. **A single hardened entry point.** The platform needs one place for cross-cutting traffic policy: routing to services, rate limiting, and entry security. These change at the pace of the platform and must not be entangled with any one frontend's needs.

Conflating both in one process makes each concern hostage to the other's release cadence and failure modes, and makes it unclear which team or review rule owns a given piece of logic.

The current split reflects this:

- `apps/web-bff` (port 3001) serves only the browser. CORS is restricted to `http://localhost:3000` via `CORS_ALLOWED_ORIGINS`.
- `apps/api-gateway` (port 3002) is server-to-server only. CORS is intentionally not enabled — browsers never call it.

## Decision

Keep the Web BFF and the API Gateway as two separate NestJS applications with a strict responsibility boundary:

- **web-bff** owns frontend response shaping: aggregation, view-model mapping, and anything that exists because the web UI needs it. It calls only the gateway, never domain services directly.
- **api-gateway** owns traffic policy: routing, rate limiting, entry security. It contains no domain rules and no frontend knowledge.
- Neither application ever contains domain logic. Domain rules live only in the (planned) domain services behind the gateway.

## Alternatives Considered

### Single combined gateway

One app doing both UI composition and traffic policy. Fewer deployables and no extra hop, but every UI-driven change redeploys the platform entry point, and the boundary between "response shaping" and "traffic policy" exists only as convention inside one codebase — the first place domain logic would leak.

Rejected: couples UI release cadence to platform hardening; boundary is unenforceable.

### Web calls services directly

No intermediary at all. Simplest possible topology, but every service must then implement CORS, rate limiting, and entry security independently; the frontend must know service topology; and cross-service aggregation moves into the browser.

Rejected: duplicates cross-cutting concerns across every service and exposes internal topology to clients.

### BFF only (no gateway)

The BFF calls domain services directly and absorbs traffic policy. Works while there is exactly one frontend, but the moment a second client appears (mobile BFF, third-party API), traffic policy must be extracted anyway — under pressure, from a codebase where it is entangled with UI shaping.

Rejected: defers the same split to a worse time. The gateway is cheap to keep separate now while it is nearly empty.

## Consequences

### Accepted costs

- One extra network hop on every frontend request (`web-bff -> api-gateway`).
- Two deployables to build, configure, monitor, and version instead of one.

### Gains

- Clean ownership: BFF changes with the UI, gateway changes with platform policy. A diff touching the wrong side is visible in review.
- The gateway stays a small, auditable surface for security and rate limiting.
- Adding a second frontend later means adding a second BFF, not restructuring the entry point.

### Risks and mitigations

- **Boundary erosion** — domain logic leaking into the BFF or gateway is the primary risk. Mitigation: review rule that neither app may contain domain rules; the BFF may shape and aggregate, the gateway may route and police, nothing else. There is no technical enforcement yet; this is a convention backed by code review.
- **Empty-gateway period** — until domain services exist, the gateway routes nothing and the hop buys nothing. Accepted: it currently carries only health and logging, so the cost is near zero.

### Revisit when

- A second frontend (e.g. mobile) appears — add a second BFF rather than generalizing the existing one.
- The extra hop shows up as a measurable latency or operational cost — re-evaluate collapsing BFF and gateway with hard data.
