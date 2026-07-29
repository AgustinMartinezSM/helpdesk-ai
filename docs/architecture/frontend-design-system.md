# Frontend design system

Status: **Implemented** (Sprint 7.5 product UI, extended for the public
surface in Sprint 7.6).

The web application has no UI dependency: no Tailwind, no component
library, no animation library. Everything below is CSS custom properties
plus one CSS Module per component or page. This document is the
reference for extending it.

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
