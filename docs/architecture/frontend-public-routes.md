# Frontend routes

Status: **Implemented** (Sprint 7.6).

`apps/web` serves two surfaces from one Next.js App Router tree, split
by route group (see [ADR 0007](../adr/0007-separate-public-and-authenticated-web-surfaces.md)).
Route groups do not appear in URLs.

## Public surface — `src/app/(public)/`

Rendered inside `PublicNav` + `PublicFooter`. Pages are Server
Components; each exports its own `metadata`.

| Route           | File                    | Purpose                                                                                                                 | Rendering                     |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `/`             | `page.tsx`              | Landing: hero, value by role, capabilities, workflow preview, security preview, architecture, project status, final CTA | Server (+ `Reveal` islands)   |
| `/how-it-works` | `how-it-works/page.tsx` | The eleven-step ticket journey, lifecycle transitions, event contracts, today-vs-target                                 | Server                        |
| `/features`     | `features/page.tsx`     | Every capability grouped by area with its status                                                                        | Server                        |
| `/security`     | `security/page.tsx`     | Real security posture, plus an explicit "not claimed" list                                                              | Server                        |
| `/about`        | `about/page.tsx`        | Why the project exists, principles, what it demonstrates                                                                | Server                        |
| `/engineering`  | `engineering/page.tsx`  | Architecture, applications, libraries, stack, decisions, delivery                                                       | Server                        |
| `/contact`      | `contact/page.tsx`      | Contact experience with honest delivery behavior                                                                        | Server + `ContactForm` island |
| `/login`        | `login/page.tsx`        | Authentication entry point                                                                                              | Client (session interaction)  |
| `/register`     | `register/page.tsx`     | Account creation — the first step of redeeming an invitation for somebody who has no account yet                        | Client (session interaction)  |

Shared: `layout.tsx` (shell + skip link), `template.tsx` (per-navigation
entrance animation), `layout.module.css`.

## Authenticated surface — `src/app/(app)/`

Rendered inside `AppShell` (sticky product header, user menu, minimal
footer). All client components — they depend on the in-memory session.

| Route           | File                    | Purpose                                                                                     |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| `/tickets`      | `tickets/page.tsx`      | Ticket list with status filters, skeletons, empty states                                    |
| `/tickets/new`  | `tickets/new/page.tsx`  | Ticket creation with priority pills                                                         |
| `/tickets/[id]` | `tickets/[id]/page.tsx` | Detail: badges, transitions, comments, internal notes, history timeline                     |
| `/account`      | `account/page.tsx`      | Profile, roles, sign out                                                                    |
| `/people`       | `people/page.tsx`       | Directory, invitations, invite and revoke — nav entry gated on people.read or people.invite |
| `/join`         | `join/page.tsx`         | Redeeming an invitation: preview, then accept, then a session refresh                       |

## Root layout — `src/app/layout.tsx`

Holds only what both surfaces share: Inter, `global.css`, the
pre-hydration theme script, `AuthProvider`, and site-wide metadata
(title template `%s — HelpDesk AI`, description, Open Graph defaults,
`metadataBase` when `NEXT_PUBLIC_SITE_URL` is set). The favicon is
`src/app/icon.svg`.

## Configuration (`src/lib/site-config.ts`)

All external links are configuration-driven; unset variables mean the UI
does not render that link at all.

| Variable                    | Effect when unset                                           |
| --------------------------- | ----------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`      | No `metadataBase` (fine locally)                            |
| `NEXT_PUBLIC_GITHUB_URL`    | GitHub links hidden (footer, contact, engineering)          |
| `NEXT_PUBLIC_LINKEDIN_URL`  | LinkedIn link hidden                                        |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Email link hidden; contact form omits the `mailto:` handoff |
| `NEXT_PUBLIC_BFF_URL`       | Defaults to `http://localhost:3001`                         |

Invalid URLs are treated as unset (validated in `site-config.ts`).

## Content sources

- `src/lib/product-status.ts` — the single source of truth for
  capabilities and project status ([ADR 0009](../adr/0009-public-product-status-representation.md)).
  Landing, features and how-it-works all render from it.
- `src/lib/format.ts` — relative and absolute date formatting.

## Adding a public route

1. Create `src/app/(public)/<route>/page.tsx` as a Server Component and
   export `metadata` (`title` gets the template applied automatically).
2. Compose with `Section`, `CapabilityCard`, `StatusPill` and the shared
   `ui` primitives — do not introduce new colors or spacing values.
3. If it belongs in the navigation, add it to `PUBLIC_NAV_LINKS` in
   `site-config.ts` (nav, mobile menu and footer read from there).
4. Any capability claim must come from `product-status.ts`, and any
   status must be derivable from the repository.
5. Add a spec that asserts the behavior or invariant the page carries —
   not merely that it renders.
