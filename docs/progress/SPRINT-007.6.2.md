# Sprint 7.6.2 — Helpi, the product guide (phases 1 and 2)

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
  says, one hint per route, with an optional next-step link. Unknown
  public routes fall back to the intro so a new page never leaves the
  guide silently broken; unknown authenticated routes get nothing.
- **`components/helpi.tsx`** — the guide itself, plus `HelpiRestore` for
  the footer.
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
| Scope           | Public pages (phase 1) and the authenticated app (phase 2)                               |

## A defect the tests caught

The launcher originally renamed itself to "Close Helpi" when open, which
collided with the panel's own close button: two controls with the same
accessible name. Fixed properly rather than worked around — a disclosure
keeps one stable name and communicates state through `aria-expanded`.

## Phase 1 was public-only

Phase 1 shipped the public pages first: the visitor who needs orientation
is the one who does not know the product yet, and the app needed its
positioning checked against real controls before a floating element could
be added there safely.

## Phase 2 — inside the app

Hints added for `/tickets`, `/tickets/new`, `/tickets/[id]` (matched by
pattern, after the exact table so `/tickets/new` keeps winning) and
`/account`. They are deliberately shorter and fewer than the public ones:
someone already working does not need to be taught the product, only
pointed at a control they may not have noticed. An unknown authenticated
route still returns nothing.

Helpi moved from `components/public/` to `components/` — it is shared
now, like the theme toggle — and is mounted as a **sibling** of
`AppShell`, whose header carries a `backdrop-filter` that would otherwise
become the containing block for its fixed positioning.

### Three measurements, three mitigations

The real work of this phase was proving Helpi never sits on a control.
Each mitigation exists because a measurement demanded it, not because it
seemed prudent:

1. **`side="left"` in the app.** Grepping the app's stylesheets found
   _three_ primary buttons aligned bottom-right — Comment, Create ticket
   and Sign out. Measured live at 1280 px: the Comment button starts at
   x=874, Helpi sits at x=24, zero intersecting controls and the button
   passes its own hit-test. Same result at 375 px (launcher 16–56 px,
   Comment ends at 359 px).
2. **Hidden while a field has focus.** On a narrow screen there is no
   empty margin, so a floating element can land on the field being used.
3. **Outside tap or scroll dismisses the panel.** Measured at 375 px on
   the ticket detail, the _open_ panel overlapped the comment textarea —
   a real violation of "never block controls". It now yields to the first
   tap outside it, and the textarea is reachable immediately after
   (verified: top element at the textarea's coordinates goes from the
   panel to `TEXTAREA`). Escape and focus restoration are unaffected.

### A verification artefact worth recording

`element.focus()` moved focus to the comment textarea but **no `focusin`
event fired**, so the typing guard appeared broken. The cause was the
environment, not the code: the browser pane did not have window focus, and
Chrome does not emit focus events in an unfocused window. Dispatching the
event the browser would normally send confirmed the listener works in both
directions. Fourth time this sprint that a "defect" turned out to be a
measurement artefact — worth checking before changing code.

## Verification

- Gate: `pnpm nx run-many -t lint,test,build,typecheck` green across all
  13 projects.
- **108 web tests** across 15 suites (was 87 across 14). New
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
- Phase 2 verified against the **running stack** (web + bff + gateway +
  auth + tickets + users, docker infra): signed in as the dev user,
  visited `/account`, `/tickets` and a real ticket detail, and measured
  overlap between Helpi and every interactive control in `main` at both
  1280 px and 375 px — **zero blocked controls** after the mitigations,
  with the dynamic-route hint resolving correctly on
  `/tickets/<uuid>`. Public pages re-checked afterwards: Helpi still
  anchors right, and Escape still closes with focus restored.

## Dependencies

**None added.** React, TypeScript, inline SVG and the existing token
system only.

## Not done

No hosted demo, no remote, no push, no CI run — all unchanged.
