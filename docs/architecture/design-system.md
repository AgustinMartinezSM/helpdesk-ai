# Design system — tokens, identity and Helpi

Status: **Implemented in Sprint 10.1.** This is the reference for extending
the system. It replaces the colour half of
[frontend-design-system.md](frontend-design-system.md), which now describes
the component inventory and the behavioural rules; the direction it
implements is [brand-strategy.md](brand-strategy.md).

The web application still has no UI dependency: no Tailwind, no component
library, no animation library. Everything is CSS custom properties in
`apps/web/src/app/global.css` plus one CSS Module per component or page. A
component that hard-codes a colour or a radius is a bug.

## The system in one line

**Ink acts, yellow marks, chroma states.** Three families, three jobs, no
overlap.

| Family     | Tokens                                                                                               | Job                                                                                 | May it mean something?                 |
| ---------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------- |
| **Action** | `--action`, `--action-hover`, `--action-on`, `--action-soft`, `--focus-ring`                         | Buttons, links, focus, selection states                                             | No — it says "you can do this"         |
| **Brand**  | `--brand`, `--brand-strong`, `--brand-soft`, `--brand-glow`, `--brand-on`, `--selection`             | The mark, emphasis, where-you-are markers, the Helpi launcher, the text highlighter | **Never on its own**                   |
| **Status** | `--info`, `--success`, `--warning`, `--danger` and their `-soft` pairs; `--status-*`, `--priority-*` | Ticket state, priority, banners                                                     | Yes — this is the only family that may |

### Why the action colour is achromatic

Not taste. The status palette already spends blue, amber, green and red on
meaning, and the brand spends pastel yellow. A chromatic action colour has
to squeeze in beside a state — which is exactly how the old indigo `#4f46e5`
ended up adjacent to the open-blue `#1d4ed8`. An achromatic action colour
collides with nothing and leaves the yellow as the only chroma in the
interface that means "brand" rather than "state".

Two tests hold that apart rather than a convention:
`--action` must be achromatic (channel spread ≤ 12) and every semantic
colour must not be (spread > 24).

### The consequence for links

With no colour to distinguish them, **inline links are always underlined**,
at one offset (`0.15em`). This extends a rule the system already had — status
is never conveyed by colour alone — to interaction.

## Tokens

Every value below was measured against **the adjacent surface**, not against
the page background. `apps/web/specs/design-tokens.spec.tsx` re-measures all
of it on every run, so the numbers in `global.css`'s comments are checked
rather than remembered.

### Neutral content

| Token              | Light     | Dark      | Rule                                 |
| ------------------ | --------- | --------- | ------------------------------------ |
| `--bg`             | `#faf9f5` | `#0d0c0a` | The page                             |
| `--surface`        | `#ffffff` | `#171613` | Cards                                |
| `--surface-2`      | `#f2f0e9` | `#211f1b` | Hover fills, wells                   |
| `--text`           | `#1a1a17` | `#f5f3ed` | ≥ 4.5:1 on every surface             |
| `--text-secondary` | `#55534c` | `#a8a49a` | ≥ 4.5:1 on every surface             |
| `--text-muted`     | `#6a6860` | `#8d8980` | ≥ 4.5:1 on every surface             |
| `--border-control` | `#847f75` | `#726e64` | ≥ 3:1 on every surface (WCAG 1.4.11) |

The neutrals are **warm**, and that is half the identity rather than a
detail. Ink on cool zinc is a recognisable current look; ink on warm paper
with a butter-yellow mark is the thing this product is trying to be. An
implementation that took the ink and skipped the warmth would have bought
nothing.

### Action

| Token            | Light     | Dark      |
| ---------------- | --------- | --------- |
| `--action`       | `#1a1a17` | `#f5f3ed` |
| `--action-hover` | `#3a3833` | `#e2dfd5` |
| `--action-on`    | `#faf9f5` | `#1a1a17` |
| `--focus-ring`   | `#1a1a17` | `#f5f3ed` |

**Focus inverts with its surface**, always with an offset so the ring lands
on the background rather than on the control. That is what makes one ring
colour per theme sufficient, and it turned the dark CTA panel's hand-written
exception — where the inherited indigo ring measured 2.87:1 — into the rule.
It now measures 15.04:1 there.

### Brand

`--brand` is `#ffee8c` in **both** themes, and `--brand-on` is `#1a1a17` in
both. That is deliberate and load-bearing: it is what lets one mark, one
launcher and one set of markers serve light and dark without forking.

- As text on the light page it measures **1.12:1**. It never carries text.
- As a surface with `--brand-on` on it, **14.83:1**.
- **Any rule that paints a brand background must set a colour in the same
  rule.** Inheriting is the bug: what it inherits differs between themes
  while the brand does not. The hero's emphasis span inherited a near-white
  heading colour in dark and measured 1.06:1 — invisible exactly where the
  emphasis was. A test enforces this now.

### Section bands

Tuned in L\* because WCAG ratios compress uselessly near both extremes.

| Band          | Light L\* | Dark L\* |
| ------------- | --------- | -------- |
| base (`--bg`) | 97.9      | 3.3      |
| raised        | 100       | 8.3      |
| sunken        | 92.6      | 1.4      |
| tinted        | 95.8      | 11.4     |

**Measure every adjacency the page produces.** The landing orders its
sections `raised → sunken → default → raised → technical → tinted`, where
`.technical` renders on `--surface-sunken` and `default` renders the page
background. Two versions of this set passed a test that checked the pairs I
expected while the rendered page carried a join under 2 L\*. The test now
derives the pairs from that sequence.

**One join per theme is carried by the `--section-border` hairline rather
than by lightness**, and both are structural: `base↔raised` in light (2.1 —
both sit near white) and `base↔sunken` in dark (2.0 — both sit at the floor).
They are listed as named exemptions in the spec, and a second test asserts
they are still that close, so an exemption cannot outlive its reason.

### Shape, depth, motion, spacing

Radii `--radius-control` 8px, `--radius-card` 12px, `--radius-pill` 999px.
Shadows `--shadow-sm|md|lg`, two soft layers each. Motion `--ease-out`,
`--dur-fast` 150ms, `--dur` 200ms — everything inside
`prefers-reduced-motion: no-preference`, and **motion only confirms a change
the user caused; nothing moves to attract attention.** Spacing is a 4px scale
named by step (`--space-1` … `--space-12`). Icons are a 24px viewBox with a
2px stroke; `--icon-sm` (14px) is a floor, not a suggestion, because below it
the stroke thins past legibility.

Breakpoints are documented in `global.css` rather than tokenised: a custom
property cannot be used inside a media query, so the four values (480, 640,
768, 1024) are still typed by hand and the comment exists to stop a fifth
appearing.

### Inverted surfaces

A region that is dark in **both** themes sets `data-surface="inverted"` and
inherits a coherent set — text, borders, action, focus, selection — instead
of rebinding tokens by hand. The final CTA panel used to rebind four, one of
which was a second indigo; that is how the last indigo in the product
survived the migration and was found by measuring the rendered page.

## The mark

A dot, a track and an end stop, in `--brand-on` on a `--brand` field.

It is the product's own smallest unit: every ticket in the interface is
already a priority dot followed by a row. Read left to right it is the
promise — a signal arrives as a point with nowhere to be, gets a track, and
reaches an end somebody decided.

| Asset                         | Where                 | Notes                                                                             |
| ----------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `components/brand/mark.tsx`   | In the app            | `size`, and `tone="mono"` for surfaces that cannot carry a field                  |
| `components/brand/lockup.tsx` | In the app            | `horizontal` (mark + wordmark) and `compact` (mark alone)                         |
| `app/icon.svg`                | Browser tab, app icon | Same geometry, token values written out — a favicon inherits no custom properties |

**Rules.** Clear space is the height of the end stop (0.22 of the mark's
box), so it scales rather than being a number to remember. Minimum size is
16px for the mark alone and 20px of mark for the horizontal lockup; below
that, use `compact`. There is **no light and dark variant** and there must
not be one — that is the payoff of the brand colour never changing.

**The wordmark is one ink weight.** "AI" used to be the only coloured word in
every header and footer: the visual place of honour given to the least
available part of the product. The name keeps its two letters; what stopped
is amplifying them.

**Prohibited**: a speech bubble, a sparkle (reserved for the AI
capabilities), a headset, a robot, a microservice diagram, and stock icon
path data. `apps/web/public/favicon.ico` — Nx scaffold artwork in an
unrelated navy — was deleted rather than restyled, so there is one mark and
one source.

## Helpi

Helpi's behavioural contract is unchanged and is documented in
[frontend-design-system.md](frontend-design-system.md). Sprint 10.1 changed
two things.

**The silhouette.** A floating circle in a bottom corner is the universal
sign for "chat with us" — the one thing Helpi is contractually not, and
everything that made it different was invisible until you opened it. It is
now a **rounded square with the mark's corner ratio**, so it reads as a
sibling of the brand mark. That gives the identity a rule worth keeping:
**the field says whose it is, the glyph says which one.** Yellow field plus
dot-track-stop is the product; yellow field plus compass is the guide.

**The language.** Helpi speaks es-AR with voseo. It is the first and only
part of the product to do so, deliberately: es-AR is the primary language
and full internationalization is Sprint 10.9, so Helpi moves first because
it is the voice in its most concentrated form, it is one file, and its specs
guard it — the cheapest place to find out what the voice sounds like before
committing every screen to it.

Rules that are now tests rather than prose:

- `CompassIcon`, never `SparklesIcon` and never a speech-bubble glyph. This
  was a doc-level rule with the same stated force as the not-a-chatbot rule,
  and only the other one had a test.
- No hint mentions a capability below `available`, on **any** route. The
  guard used to scan public routes only, which left the one hint that
  mentioned AI permanently unchecked — and it was the one that overstated.
- Every authenticated route has a hint or is silent by a rule.
  `/organization` had neither and fell through to the public marketing
  intro, so an administrator configuring branches was offered a tour of the
  product they were already inside.
- The chatbot blacklist speaks both languages. An English-only list would
  have guarded nothing the moment the copy became Spanish, while still
  reading as coverage.
- The Spanish is voseo, checked against the tuteo forms of the verbs the
  copy actually uses.

**Helpi has no loading state and must never grow one.** Nothing it says is
fetched or generated, so a spinner would be theatre implying a capability
that does not exist.

## Migration notes

**`--accent*` is gone, and the two-step is the part worth reusing.**

Step one (Sprint 10.1) redefined the old names in terms of the new ones. All
73 call sites kept working, the product looked right immediately, and the
migration stopped being urgent. Step two (10.2) moved the remaining 44 sites
to the token that owns each JOB and deleted the aliases — and that is where
the value was, because **the same `--accent` was doing four different
things**: an action, a focus ring, an identity chip, and a colour twelve
elements had only because a colour was there. A find-and-replace would have
made all four the same thing permanently.

Two tests replace the aliases. One asserts no `--accent` token is declared
and no stylesheet reaches for one. The other is the general form of the same
trap, and it earned its place immediately: **`var(--typo)` is not an error in
CSS** — it falls back to the inherited or initial value and the page renders
— so a mistyped token is invisible until somebody looks at the pixel. Checked
against the declared set, five undefined tokens turned up in shipped code,
the worst of them a `--surface-1` with no fallback that had been leaving the
invitation-code block with no background at all.

## Known visual debt

Four items on this list were closed in Sprint 10.2: the social preview, the
404 and error surfaces, the Account screen's raw role keys, and specs
type-checking. What is left:

- **Checkboxes and radios have no primitive.** The organization screen styles
  native inputs directly. There is no Dialog, Banner or Tooltip component
  either; nothing in the product needs one yet, and inventing them ahead of a
  use case would be inventing their API too.
- **Only the public surface was verified in a real browser.** An
  authenticated screen needs six dev servers and the preview tool allows
  five — a constraint Sprints 9.10 and 9.13 both hit. The authenticated
  components inherit the same tokens and are covered by specs, but nobody has
  looked at them.
