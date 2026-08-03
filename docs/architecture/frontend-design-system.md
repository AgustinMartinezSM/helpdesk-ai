# Frontend design system

Status: **Implemented** (Sprint 7.5 product UI, extended for the public
surface in Sprint 7.6).

The web application has no UI dependency: no Tailwind, no component
library, no animation library. Everything below is CSS custom properties
plus one CSS Module per component or page. This document is the
reference for extending it.

**This describes the system as built.** Sprint 10.0 decided a different
direction for it — warm neutrals, an achromatic action colour, the brand
yellow promoted to signature, and the mark rebuilt — in
[brand-strategy.md](brand-strategy.md), with the measurements it rests on.
Sprint 10.1 implements that; until it does, everything below is still what
the code does, and the two documents disagree on purpose.

## Principles

1. **Tokens, never raw values.** A component that hard-codes a color or
   a radius is a bug: it will break one of the two themes.
2. **Both themes are first-class.** Every token has a light and a dark
   value; nothing is "dark mode as an afterthought".
3. **Motion is optional decoration.** Anything that moves lives inside
   `@media (prefers-reduced-motion: no-preference)`, and no information
   is conveyed by motion alone.
4. **Accessibility is part of the component**, not a later pass: focus
   rings, labels, error association and text labels for every status.

## Tokens (`apps/web/src/app/global.css`)

Defined on `:root`, overridden under `[data-theme='dark']`.

### Surfaces and text

| Token              | Purpose                                            |
| ------------------ | -------------------------------------------------- |
| `--bg`             | Page background                                    |
| `--surface`        | Cards, header, footer                              |
| `--surface-2`      | Hover fills, subtle wells                          |
| `--text`           | Primary text                                       |
| `--text-secondary` | Body copy, descriptions                            |
| `--text-muted`     | Meta, captions (AA-verified in both themes)        |
| `--border`         | Hairlines between regions                          |
| `--border-strong`  | Emphasized separators, chips                       |
| `--border-control` | Form-control boundaries — kept ≥ 3:1 (WCAG 1.4.11) |

### Accent and feedback

`--accent`, `--accent-hover`, `--accent-contrast`, `--accent-soft`
(indigo: `#4f46e5` light, `#818cf8` dark); `--danger`, `--danger-soft`.

Indigo is the **action colour and the accent text colour** in both
themes — 6.02:1 on the light background, 6.67:1 on the dark one.

### Brand accent — pastel yellow (decorative and surface only)

| Token            | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `--brand`        | Fills: markers, chips, rules, highlight surfaces    |
| `--brand-strong` | Hairlines and edges that need a touch more presence |
| `--brand-soft`   | Low-opacity washes behind headers and icon tiles    |
| `--brand-glow`   | Ambient radial fields                               |
| `--brand-on`     | The text colour to place **on** a `--brand` surface |

**The rule, and why it exists.** Measured against the real tokens:

| Pastel yellow used as…            | Light          | Dark       |
| --------------------------------- | -------------- | ---------- |
| Text on the page background       | **1.13:1** ❌  | 16.92:1 ✅ |
| Text on a card surface            | **1.18:1** ❌  | 15.77:1 ✅ |
| A surface, with `--brand-on` text | **15.07:1** ✅ | 15.07:1 ✅ |

So the brand colour **never carries text and never carries information
on its own.** It is a fill, an edge or a glow; when it becomes a
surface, `--brand-on` supplies the text. This keeps the brand identical
in both themes instead of splitting into a light and a dark personality,
and it keeps every combination above AA.

### Domain color

Ticket status (`--status-{open,progress,resolved,closed}-{fg,bg,dot}`)
and priority (`--priority-{low,medium,high,urgent}`). These drive both
the product `StatusBadge`/`PriorityDot` and the public `StatusPill`, so
a status looks the same everywhere it appears.

### Shape, depth, motion

- Radii: `--radius-control` (8px), `--radius-card` (12px),
  `--radius-pill` (999px).
- Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-lg` — two soft layers
  each, darker and more opaque in the dark theme.
- Motion: `--ease-out` (`cubic-bezier(0.2, 0, 0, 1)`), `--dur-fast`
  (150ms), `--dur` (200ms).

### Public surface (Sprint 7.6)

| Token                | Value                             | Purpose                          |
| -------------------- | --------------------------------- | -------------------------------- |
| `--container-public` | `72rem`                           | Max width of public page content |
| `--section-gap`      | `clamp(4rem, 9vw, 6.5rem)`        | Vertical rhythm between sections |
| `--display-xl`       | `clamp(2.375rem, 5.5vw, 3.5rem)`  | Page titles / hero               |
| `--display-lg`       | `clamp(1.875rem, 4vw, 2.5rem)`    | Section titles                   |
| `--display-md`       | `clamp(1.375rem, 2.5vw, 1.75rem)` | Sub-section titles               |

### Section surface levels (Sprint 7.6.1)

Sprint 7.6 alternated `--bg` and `--surface`. They are **1.7 L\* apart**,
which is imperceptible — every public page read as one continuous sheet.
The levels below are tuned in **L\*** (perceptual lightness) rather than
WCAG contrast ratio, which compresses badly near white and near black
and reported both pairs as "1.04:1" regardless of how they were changed.

| Token              | Light L\* | Dark L\* | Use                                    |
| ------------------ | --------- | -------- | -------------------------------------- |
| `--bg` (base)      | 98.3      | 2.5      | The page itself                        |
| `--surface-raised` | 100       | 8.5      | Elevated band; cards separate from it  |
| `--surface-sunken` | 93.4      | 1.4      | Recessed band for supporting content   |
| `--surface-tinted` | 96.8      | 8.8      | Warm brand-tinted band, human sections |
| `--surface-cta`    | —         | —        | Contained dark panel for the final CTA |

Adjacent sections now land 3.4–7.4 L\* apart, reinforced by a
`--section-border` hairline. `--grid-line` draws the faint engineering
grid used by the `technical` tone and the hero.

`Section` exposes these as `tone="default | raised | sunken | tinted | technical"`
and reflects the choice in `data-tone`, so specs can assert that no two
adjacent sections share a surface.

## Typography

Inter via `next/font/google` (self-hosted at build time, exposed as
`--font-sans`). Headings use `-0.02em` letter-spacing (`-0.03em` for
display sizes); numeric meta uses `font-variant-numeric: tabular-nums`;
monospace stays system (`ui-monospace`) for event names and identifiers.

## Theming

`prefers-color-scheme` is the default, a header toggle overrides it, and
the choice persists in `localStorage`. A tiny inline script in the root
layout applies `data-theme` to `<html>` **before hydration** so there is
no flash; the storage read has its own `try/catch` so a blocked-storage
environment still falls back to the OS preference. `color-scheme` is set
per theme so native controls follow.

## Component inventory

### Product primitives (`src/components/ui/`)

| Component                              | Notes                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` / `ButtonLink`                | primary, secondary, ghost, danger × sm, md. `loading` uses `aria-disabled` (not `disabled`) so keyboard focus survives a submit; forms must guard against re-entry. |
| `Field`, `Input`, `Textarea`, `Select` | Label above, focus ring, error linked via `aria-describedby` + `aria-invalid`. `Textarea` auto-grows, including on programmatic value changes.                      |
| `Card`                                 | Surface + border + shadow; `interactive` adds hover elevation.                                                                                                      |
| `StatusBadge`, `PriorityDot`           | Text label always present — never color alone.                                                                                                                      |
| `Skeleton`                             | Shimmer, motion-gated; wrap groups in `role="status"`.                                                                                                              |
| `EmptyState`                           | Icon + title + hint + action.                                                                                                                                       |
| `icons.tsx`                            | ~30 inline glyphs, Lucide path data (ISC), all `aria-hidden`.                                                                                                       |

### Public components (`src/components/public/`)

| Component             | Notes                                                                                                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PublicNav`           | Client island. Sticky, blurred. Mobile panel manages focus (moves in, cycles, Escape restores), locks body scroll, sets `aria-expanded`/`aria-controls`, marks the active route with `aria-current`. |
| `PublicFooter`        | Server. External links render only when configured.                                                                                                                                                  |
| `Section`             | Server. Eyebrow + heading + lead + content, `default` or `raised` tone for page rhythm.                                                                                                              |
| `StatusPill`          | Renders `CapabilityStatus` with its text label.                                                                                                                                                      |
| `CapabilityCard`      | Capability + status + optional icon and note.                                                                                                                                                        |
| `HeroVisual`          | Product scene composed from real primitives; fully `aria-hidden` (its content is stated in the hero copy).                                                                                           |
| `ArchitectureDiagram` | `role="img"` with a full textual description; the travelling event pulse is decorative and motion-gated.                                                                                             |
| `Reveal`              | Client. IntersectionObserver section reveal that is a no-op without JS, under reduced motion, or for content already on screen — content is never hidden in a degraded mode.                         |
| `ContactForm`         | Client. Validation, accessible errors, duplicate protection, honest success state (see ADR 0008).                                                                                                    |

## Motion catalogue

| Effect                           | Where                     | Guarded                                             |
| -------------------------------- | ------------------------- | --------------------------------------------------- |
| Page fade-up (`.page-enter`)     | Both `template.tsx` files | Yes                                                 |
| Section reveal (`[data-reveal]`) | Public pages              | Yes (and JS-optional)                               |
| Hover lift                       | `Button`, `Card`          | Yes                                                 |
| Menu / dropdown entrance         | `PublicNav`, `AppShell`   | Yes                                                 |
| Skeleton shimmer                 | `Skeleton`                | Yes                                                 |
| Architecture event pulse         | `ArchitectureDiagram`     | Yes                                                 |
| Spinner rotation                 | `Button` loading          | Falls back to an opacity pulse under reduced motion |
| Inline-link arrow nudge          | Landing section CTAs      | Yes                                                 |

## Helpi — the product guide

`components/helpi.tsx` is a small floating guide mounted in **both**
shells — bottom-right on the public site, bottom-left in the authenticated
app, with its own hint set for each. (It lived under `components/public/`
when it was public-only; the path here said so for longer than it was
true.)

It is **written guidance, not a chatbot and not AI**, and that distinction
is a hard constraint rather than a preference. The reason is structural
rather than a matter of current status: every string is authored by hand
and selected by route, so a companion that behaved like an AI assistant
would promise a kind of answer nothing behind it can produce — and on the
public site specifically, one no visitor can reach at all, since the AI
capabilities are staff-only and live inside the product. Concretely,
Helpi:

- has **no text input and no conversation** — every hint is authored by
  hand in `lib/helpi-hints.ts` and selected by route;
- carries the line _"Short written hints — not a chatbot."_ in its panel;
- must never use `SparklesIcon` (reserved for the AI features) or a
  speech bubble (reads as chat). Its mark is `CompassIcon` —
  orientation, not conversation;
- is guarded by specs that reject "ask me", "chat with", "AI assistant"
  and any capability `product-status.ts` marks `planned`.

It is also the **one persistent place where the brand yellow is a
surface** rather than decoration: `--brand-on` over `--brand` measures
15.07:1, verified live in both themes.

Behavioural rules worth knowing before changing it:

- **A disclosure, not a dialog.** No `aria-modal`, no focus trap, no
  blocking. `aria-expanded` + `aria-controls` on a launcher whose
  accessible name never changes; Escape closes and restores focus.
- **Never steals focus** when it opens itself on a first desktop visit,
  and it does not auto-open on small screens at all.
- **Mounted as the last child of the public shell.** Any ancestor with a
  `backdrop-filter` — the nav has one — would become the containing block
  for its `position: fixed` and collapse it. Being last also puts it at
  the end of the tab order, which is right for a supplementary control.
- **Hides while the mobile menu is open**, off `html[data-menu-open]`,
  so it can never overlap navigation.
- **Dismissal is remembered but reversible**: a footer control
  (`HelpiRestore`) brings it back, because one click should not remove a
  feature permanently. Blocked storage degrades to "the choice is not
  remembered", never to "the guide is gone".
- **Never in the way of a control.** Three mechanisms, each added because
  a measurement demanded it:
  - `side="left"` in the authenticated app, since every primary button
    there (Comment, Create ticket, Sign out) sits bottom-right;
  - it disappears while an `input`, `textarea` or `select` has focus — on
    a narrow screen there is no empty margin to sit in;
  - a tap outside it or any scroll dismisses the open panel, because at
    375 px the panel measurably covers the comment textarea on the ticket
    detail. Neither path moves focus; the user is already elsewhere.
- Unknown authenticated routes return no hint: guessing inside a tool
  someone is working in is worse than staying quiet.

Adding a hint for a new route means editing `helpi-hints.ts` and nothing
else. If the route is dynamic, add a pattern **after** the exact-match
table so `/tickets/new` keeps winning over `/tickets/<id>`.

## Content voice

The public pages are not all written in the same voice, and that is
deliberate:

- **`/about` is first person.** It is my account of why the project
  exists, so it says "I created", "I wanted", "I decided" — never
  "Agustín created" or "the developer believes". My name appears once,
  as attribution. `trust-pages.spec.tsx` asserts the first-person
  markers and rejects the third-person patterns, so the voice cannot
  quietly regress.
- **`/how-it-works` is written for someone who has never used a help
  desk.** Plain language comes before any technical term: it defines a
  ticket as "a request for help that stays organized" before using the
  word, and the deep vocabulary (event names, DTOs, cookies) lives on
  `/engineering` instead.
- **Everywhere else is product voice** — direct, concrete, and bound by
  `product-status.ts` for anything that claims a capability exists.

## Rules for extending

- Add a token before adding a value; if a value appears twice, it is a
  token.
- New interactive elements need a visible `:focus-visible` state (the
  global ring is the default — do not remove it without replacing it).
- Any new animation goes inside the reduced-motion guard, and the
  content must be complete and visible without it.
- Public pages stay Server Components; push interactivity down into the
  smallest possible client island.
- Verify both themes and 320 px before calling a component done.
