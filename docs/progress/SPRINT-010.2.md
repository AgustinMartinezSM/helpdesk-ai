# Sprint 10.2 — Finishing the migration, and the surfaces nobody had written

Status: **CLOSED (2026-08-03).** Remote CI green on the final HEAD: run
[`30846715801`](https://github.com/AgustinMartinezSM/helpdesk-ai/actions/runs/30846715801)
on `bc593e6`, green on its first attempt, covering all six commits — they were
pushed together.

## A note on how this one was opened

The last thirteen sprints each began with a Definition of Ready written
before any code. This one did not: the work was already enumerated — the
handoff named it as the exact next action, and
`docs/architecture/design-system.md` listed the debt with evidence — so I
verified the repository state and started.

That was defensible for a sprint whose entire scope was a list somebody else
had already written down, and it is worth saying rather than back-dating a
document. It would not have been defensible for a sprint that had to decide
anything, and the readiness facts are recorded below in the place they would
have been.

**Previous dependency complete.** Sprint 10.1 merged and closed with remote
CI green: run `30840468940` on `309d498`, and its closing record on
`3a21b7f`. `main` equalled `origin/main` at `3a21b7f`, working tree clean.

**Scope, taken verbatim from the handoff and the design-system debt list:**
retire the `--accent*` aliases; write the missing `not-found` and `error`
surfaces; add a social preview image; stop the Account screen printing raw
role keys; get `apps/web/specs` type-checked.

## Outcome

Everything in scope landed, and three of the five turned out to be hiding
something.

### The `--accent*` retirement

44 call sites across 20 files, and the reason 10.1 aliased rather than
replaced is exactly what made this worth doing by hand: **the same token was
doing four different jobs.**

| Job                                                                         | Sites | Moved to                                    |
| --------------------------------------------------------------------------- | ----- | ------------------------------------------- |
| Action — buttons, skip links, inline links, a native `accent-color`         | 15    | `--action`, `--action-hover`, `--action-on` |
| Focus — a field's border and the halo it draws inside its own box           | 2     | `--focus-ring`, and a new `--focus-halo`    |
| Identity — icon tiles, initial avatars, ambient fields, "this one is yours" | 15    | `--brand-soft`, `--brand`, `--brand-strong` |
| Nothing — a service name, a quoted draft, a timeline node, a sample chat    | 12    | `--text`, `--border-strong`, `--surface-2`  |

A find-and-replace would have made all four the same thing permanently. The
last column is the one that could only be decided by reading: those twelve
were coloured because a colour was there, not because they meant anything,
and several of them looked actively wrong once the action colour became
achromatic — `--accent-soft` resolved to a 7% ink wash, which on warm paper
is a grey smudge where an icon tile wanted a brand chip.

**`--focus-halo` is the one token this sprint added.** A form control cannot
use the offset ring — its own border radius clips it — so it draws a soft
inner halo instead. That halo is now the ring colour at low opacity rather
than a colour of its own, so the two cannot drift apart.

The aliases are gone, and two tests replace them: one asserts no `--accent`
token is declared and no stylesheet reaches for one, the other is the general
form of the same trap.

### The general trap, and the five real bugs it found

`var(--typo)` is not an error in CSS. It falls back to the inherited value,
or to the property's initial value, and the page renders — so a mistyped
token is invisible until somebody looks at the pixel. The new test resolves
every custom property every stylesheet asks for against the ones actually
declared, and it found **five undefined tokens in shipped product code**:

- **`--surface-1`** on the invitation-code block, with no fallback. That
  block has been rendering with **no background at all** — a code meant to
  sit in a recessed well, sitting on bare card. This is the one a person
  would have noticed eventually and nobody did.
- **`--text-primary`**, twice, on the status tags in People and Organization.
  No fallback, so the declaration is invalid and the element inherits its
  colour — which happened to look right, which is why it survived.
- **`--radius-input`** with a `0.5rem` fallback that happens to equal
  `--radius-control`. Accidentally correct.
- **`--font-mono`** with a fallback carrying it. Monospace stays system in
  this repository; there is no such token and there should not be.

None of these was introduced by the migration. They were all older than it,
and none of them could fail a test until there was a test for the shape of
the mistake rather than for the mistake.

### The two screens nobody had written

A mistyped URL and a thrown segment both fell back to unbranded Next
defaults — the two moments a person is most likely to conclude the product is
broken.

`not-found.tsx` and `error.tsx` live at the **root**, not inside a route
group: a URL matching no route matches no group either, so a `not-found`
under `(public)` would never render for the addresses that need it most.
They carry the mark rather than a shell, because neither shell can be
assumed — `AppShell` needs a session, and mounting it would make a mistyped
URL depend on the BFF being up.

Two decisions in the error screen worth keeping:

- **`error.message` never reaches the screen.** Next redacts it in
  production and leaves it real in development, and a screen that shows a
  stack trace in one environment and not the other teaches people to distrust
  it. The `digest` is shown instead — the id that ties the screen to the
  server log, which is the thing somebody reporting the problem can quote.
  The real error still goes to the console, where a developer looks and a
  visitor does not.
- **It promises nothing about the cause.** Every domain refusal in this
  product renders inside the page that raised it (ADR 0020). Reaching this
  screen means the product genuinely does not know what happened, and
  guessing would be worse than saying so.

Neither apologises. "Sorry" invites the reader to think somebody failed them;
a test rejects it, along with "did you mean", which claims a guess the page
has no basis for.

### The social preview

Every link shared to this project rendered without an image — the first
impression the brand work never reached, and the only place the mark appears
off-site.

It is **generated, not drawn**, for a reason beyond convenience: a binary in
the repository is a second source of truth for the identity and it goes stale
silently — nothing fails when the mark changes and the PNG does not. The
geometry in `opengraph-image.tsx` is the same geometry as `mark.tsx` and
`icon.svg`, so a reviewer can diff it. It carries the descriptor and the
promise, the status line, and deliberately **not** the brand line: "from
signal to resolution" is meant to be rare, and a preview card is where a line
gets used most.

### The Account screen

It printed `session.user.roles` straight into spans, so the one screen where
a person looks at their own role said **"agent"** where every other screen
says "Technician". The label layer exists precisely so a stored key never
reaches the interface, and this was the one place it was skipped.

The test that now guards it reads the source rather than the DOM, because the
defect is a missing call — a screen showing a key whose label happens to be
identical would pass a rendered assertion. A first version of that test
flagged `key={role}` and `{styles.role}` as well, which is how a check earns
a reputation for crying wolf; it matches JSX text children only.

### `apps/web/specs` is type-checked, and the reason it was not is worse than "nobody set it up"

Five sprints have added files to that directory and every sprint record noted
it was outside type-checking. The reason was two compounding faults:

1. **`tsconfig.spec.json` listed `src/**/*.spec.tsx`**, which matches
   nothing — this app's tests live in `apps/web/specs`.
2. **It referenced `./tsconfig.json`, which sets `noEmit`.** A referenced
   project may not disable emit, so `tsc -p apps/web/tsconfig.spec.json`
   failed with **TS6310 before reading a single file**. Anyone who had tried
   to type-check the specs would have hit a config error and reasonably
   concluded the setup was broken. It was.
3. And `@helpdesk-ai/web` had **no `typecheck` target at all** — which is why
   the gate said "14 projects" while the workspace has 15, a number that had
   been printed on every run for months.

All three are fixed: the include points at the real directory, the reference
is gone, and an explicit target runs it. `pnpm typecheck` now covers **15
projects**. The specs were type-clean, so nothing had to be repaired — but
they are checked now, and I verified the check is not vacuous by introducing
a deliberate type error, watching it fail, and removing it.

## Verification

Full gate green: format, lint, **typecheck across 15 projects**, 260 unit
tests across 28 suites, and build.

In a real browser: the 404 renders with the mark and the tokens in both
themes; the social preview renders at 1200×630; and the landing still shows
zero elements reaching for a token that does not resolve.

**The authenticated surface was again not opened in a browser** — six dev
servers against five preview slots, unchanged since 9.10. The Account fix in
particular is covered by a source-level test and by the existing render
specs, and nobody has looked at it.

**One thing this sprint cost and is worth recording**: I deleted
`apps/web/.next` while the dev server was running, which corrupted its state
and produced an `Internal Server Error` that looked like a defect in the new
OG route. The route was fine. `rm -rf .next` is safe before starting a dev
server and destructive during one.

## Documentation

- `docs/architecture/design-system.md` — the migration notes now describe a
  finished two-step rather than a pending one, and the debt list lost the
  four items this sprint closed.
- `docs/handoffs/CURRENT-HANDOFF.md` — Sprint 10.2's entry, and 10.3 as the
  next exact action.

No fictional experience, customer, testimonial, incident, external approval
or commercial adoption was introduced.
