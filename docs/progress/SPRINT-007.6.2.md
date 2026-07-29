# Sprint 7.6.2 — Helpi, the product guide

Status: complete. Branch: `feature/HD-076-product-experience`.
Date: 2026-07-29.

## Goal

Add a small floating companion to the public pages that helps a visitor
understand the product and find the important sections — a lightweight
guide, not a decorative mascot and not a fake chatbot.

## The constraint that shaped the design

The public site states that AI assistance is `Planned`, and specs fail if
that ever stops being true. A floating assistant is exactly what a
visitor reads as _"the AI already works"_, so the sharpest risk here was
not visual — it was that Helpi could quietly undo the honesty mechanism
the previous two sprints were built around.

Helpi is therefore a **deterministic written guide**: hints authored by
hand, selected by route, with no text input, no conversation and no
generation. Two visual prohibitions follow from the same reasoning: no
speech bubble (reads as chat) and no `SparklesIcon`, which is reserved
for the planned AI capabilities. Its mark is a compass — orientation.

The panel also states it plainly: _"Short written hints — not a
chatbot."_

## What was built

- **`lib/helpi-hints.ts`** — the single source of truth for what Helpi
  says, one hint per public route, with an optional next-step link.
  Authenticated routes return `null`; unknown public routes fall back to
  the intro so a new page never leaves the guide silently broken.
- **`components/public/helpi.tsx`** — the guide itself, plus
  `HelpiRestore` for the footer.
- **`CompassIcon`** in the shared icon set.
- Mounted as the **last child of the public shell**, and `PublicNav` now
  sets `html[data-menu-open]` so Helpi can hide while the mobile menu
  owns the screen.

### Brand accent

Helpi is the one persistent element where the pastel yellow is a
_surface_ rather than decoration — its intended accessible use.
`--brand-on` over `--brand` measured **15.07:1 in both themes**, verified
live. A brand rule ties the panel to the launcher without tinting any
text.

### Behaviour

| Concern         | Decision                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------- |
| Kind of widget  | Disclosure — no `aria-modal`, no focus trap, blocks nothing                              |
| Launcher name   | Stable ("Helpi, the product guide"); state lives in `aria-expanded`                      |
| Keyboard        | Escape closes and returns focus to the launcher                                          |
| First visit     | Opens itself once on desktop **without taking focus**; never auto-opens on small screens |
| Dismissal       | Remembered in `localStorage`, and reversible from the footer                             |
| Blocked storage | Degrades to "the choice is not remembered", never to "the guide is gone"                 |
| Motion          | Entrance gated by `prefers-reduced-motion`; **no idle animation at all**                 |
| Stacking        | `z-index: 15` — under the header (20) and the mobile panel (19)                          |
| Scope           | Public pages only                                                                        |

## A defect the tests caught

The launcher originally renamed itself to "Close Helpi" when open, which
collided with the panel's own close button: two controls with the same
accessible name. Fixed properly rather than worked around — a disclosure
keeps one stable name and communicates state through `aria-expanded`.

## Why public-only in phase 1

Two of the requested example hints ("Create a ticket here", "Use these
filters") are authenticated routes, so they wait for phase 2. The
reasons: the visitor who needs orientation is the one who does not know
the product yet; inside the app a floating element at the bottom right
competes with real controls (the comment submit button lives there),
which would violate "never block controls"; and the app already onboards
through skeletons and empty-state CTAs.

Phase 2 would add per-route hints for `/tickets`, `/tickets/new` and
`/tickets/[id]`, mounted in the `(app)` layout with positioning checked
against the existing controls by real geometry.

## Verification

- Gate: `pnpm nx run-many -t lint,test,build,typecheck` green across all
  13 projects.
- **101 web tests** across 15 suites (was 87 across 14). New
  `helpi.spec.tsx` covers: a hint per public route within the length
  budget; **no invitation to converse and no AI claim**; no hint naming a
  `planned` capability; silence on authenticated routes; no text input
  anywhere; `aria-expanded`/`aria-controls`; Escape closing with focus
  restored; not marking itself modal; dismissal persisting across mounts;
  restoration from the footer; and survival when `localStorage` throws.
- Browser pass with real measurements, not DOM presence: launcher 40×40
  at 24 px from the edge and **hit-testable**; panel inside the viewport
  in both desktop and mobile; **glyph contrast 15.07:1 in both themes**
  and zero panel-text failures; Escape closes and focus returns; reopens
  by keyboard; **hidden with `display: none` while the mobile menu is
  open**, with the corner it occupies free to hit-test; no auto-open at
  375 px; panel 343 px wide with no page overflow; the full
  dismiss → footer restore → back cycle; correct route-specific hint on
  `/how-it-works`. No console or server errors.

## Dependencies

**None added.** React, TypeScript, inline SVG and the existing token
system only.

## Not done

No hints inside the authenticated app (phase 2). No hosted demo, no
remote, no push, no CI run — all unchanged.
