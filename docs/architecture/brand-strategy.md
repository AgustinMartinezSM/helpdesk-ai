# Brand strategy

Status: **Decided in Sprint 10.0 (2026-08-03).** This is a direction, not an
implementation. Sprint 10.1 builds the design system from the rules below;
nothing here changed a page, a token or a claim.

This is the authoritative brand document. Where it disagrees with a page, the
page is wrong and 10.1 fixes it — with one exception that outranks everything
in this file: `apps/web/src/lib/product-status.ts` remains the source of truth
for what the product may claim (ADR 0009). This document says how to say
things. That file says what is true.

## Why this sprint happened before any redesign

The product got substantially better through Block A and the way it presents
itself did not keep up. Five public surfaces each froze at a different sprint —
`product-vision.md` at Sprint 1, `README.md` at 9.2, `SECURITY.md` at 9.8,
`frontend-public-routes.md` at 7.6, `product-status.ts` at 9.12 (two of those
were corrected during this sprint and are noted at the end) — so the site
tells visitors the support-teams screen "is planned" while an administrator has
been using it since 9.13. Four different taglines coexist. The one visual asset
that is actually ours, the pastel yellow, appears inside the authenticated
product in exactly one place, and the mark is a stock icon on a Tailwind
indigo tile.

Redesigning pages first would have meant deciding all of that by accident, one
component at a time. So this sprint decides it on purpose and writes it down.

## Executive summary

HelpDesk AI is a help desk for internal requests, built for organizations whose
work happens in more than one place. Its central claim is not speed and not
automation: it is that **every request gets a place, an owner and an ending, and
you can see all three**.

The brand rests on something unusual and verifiable — this project's claims are
enforced by tests. Capability statuses live in one module, the landing and
features pages render from it, and a spec fails CI if a status is quietly
promoted. A brand built on candor is only worth building when the candor is
structural, and here it is — **structural with six hard-coded exceptions this
sprint found and 10.1 removes.** That qualified sentence is the honest version
and the one to use. Do not restore the unqualified one, and do not reach for
ADR 0009's own phrasing either: it says landing, features **and how-it-works**
render from the module, and how-it-works imports `StatusPill` without importing
the module at all.

Three decisions drive everything downstream:

1. **Ink acts, yellow marks, chroma states.** The interactive colour becomes
   near-black on warm paper (inverted in dark), the pastel yellow becomes the
   signature that marks where you are and what is ours, and the blue/amber/
   green/red palette stays reserved for status and priority — the only colours
   permitted to carry information. Indigo leaves. The reasoning is measured,
   not aesthetic, and is in the visual section.
2. **Helpi keeps its behaviour and changes its language.** Everything it does
   is already right; everything it says is English. It becomes naturally
   rioplatense, with voseo, and stays a written guide that is not AI.
3. **"From signal to resolution" is adopted as the idea, and its Spanish is an
   interpretation rather than a translation:** _"De un aviso suelto a un problema
   resuelto."_

## What I retained, evolved, and threw out

I audited the public site, the authenticated app, the visual tokens, Helpi and
the capability record before proposing anything. The short version:

**Retained** — the status-pill honesty system and its ADR; the "AI as an
assistant, never an authority" doctrine, which matches the code (suggestions
never mutate a ticket); the consequence-first microcopy already in the product;
the requester's `Confirm fix and close`; the department-versus-support-team
explainer written into the Organization screen; the measured-contrast culture;
Helpi's entire behavioural contract; product scenes built from real primitives
instead of stock illustration.

**Evolved** — the accent colour and the neutral substrate; the logo and the
wordmark; the four competing taglines, collapsed into one architecture; the
multi-tenant story, which is the actual product and is nearly absent from public
prose; Helpi's language.

**Generic, and going** — Tailwind zinc plus indigo-600, which is the single most
common SaaS palette in existence; the stock Lucide ticket on a rounded tile as a
logo; headings like "Everything a support operation needs"; the floating yellow
circle whose silhouette conventionally means "chat with us", which is the one
thing Helpi refuses to be.

**Misrepresenting** — and this is the surprise: the site does not overstate. It
_understates_, systematically, because it lagged the product. The defects section
at the end enumerates where, and there were more of them than I expected when I
started counting. The single exception runs the other way, and it is inside the
product rather than on the site: the authenticated shell's footer claims
"AI-assisted support" with no status qualifier.

## Audiences

Five audiences, in the order the brand serves them. Each names the problem in
that audience's own words, not the product's.

### 1. Multi-branch retailers and operational companies — the primary buyer

Ten to two hundred people across stores, branches or sites. Something breaks at
a specific place, and the message that arrives says "the till isn't working"
with no way to know which store, which register, who is on it, or whether it is
still broken.

- **Primary buyer:** operations manager, or the IT lead who reports to them.
- **Daily user:** branch staff, often on a shared terminal, often in a hurry.
- **Administrator:** the same ops or IT lead.
- **Internal champion:** a regional manager who covers several branches and
  currently has no view across them.
- **Problem to solve:** a request without a place is a request nobody can act
  on or count.
- **Objections:** _"our branch staff will never log in."_ Answer: a login can
  declare the machine shared, the session dies with the browser, and the form
  remembers the place — never the person. _"We already have a WhatsApp group."_
  Answer: keep it; what the group cannot do is tell you what is still open.

This audience is primary because it is where the product's actual
differentiation pays off. A ticket carries the branch and the service point it
came from, each validated at creation; a support team's reach across branches is
an explicit join. That is a lot of machinery for a single-site company and
exactly right for this one.

### 2. Small businesses without a formal support department — the entry point

Eight to forty people, one address, one person who fixes everything and one
WhatsApp thread where all of it lives.

- **Primary buyer, daily user, administrator and champion are frequently the
  same person.**
- **Problem to solve:** everything depends on one person remembering.
- **Objections:** _"this looks like too much for us."_ It is the fair objection,
  and the honest answer is that branches and departments are optional — one
  support team with no branch rows serves the whole organization, which is what
  the empty state on the Organization screen already says.

The brand must never make this audience feel like it walked into an enterprise
tool. It is the cheapest pilot and the fastest proof.

### 3. Larger organizations with support teams and structured permissions — the ceiling

They already have a service desk. What they need is for the permission model to
survive contact with their org chart.

- **Primary buyer:** service desk or IT manager.
- **Daily user:** technicians and team managers.
- **Administrator:** an organization administrator who is not the same person.
- **Champion:** the service desk manager, who is the template the permission
  work was built around.
- **Problem to solve:** who may see what, and can you prove who changed it.
- **Objections and trust requirements:** SSO, custom roles, an audit UI,
  instant revocation. **We do not have four of those**, and the strategy's
  answer is to say so rather than to imply otherwise. See the deferred claims.

This audience is a ceiling the model supports and the product has not yet
earned publicly. Address it in `/security` and `/features`, never in the hero.

### 4. Employees and requesters — the daily user who did not ask for software

Somebody whose printer is broken, who wants to tell the right person once and
get on with their day.

- **Problem to solve:** asking twice; not knowing whether anyone saw it.
- **Trust requirement:** the form must be shorter than a WhatsApp message is
  long, and the ending must be theirs. It is: the requester holds
  `Confirm fix and close`.
- **Language:** this audience gets the word **request**, never "ticket", never
  "incident", never "case".

### 5. Managers and technicians — the people accountable for the outcome

- **Problem to solve:** work arriving with no context, and no way to place it
  with the group that should have it.
- **Trust requirement:** that the tool does not create a second job. Routing is
  one control; history is written by the platform; nothing AI-shaped runs until
  somebody asks for it.

### The reader the repository cannot hide

There is a sixth reader: the engineer or hiring manager evaluating this as a
portfolio project. That is real — there are no customers, nothing is deployed,
and the About page says so in the first person.

**One voice serves both readers, and the business reader leads the page.** The
candor that makes this credible to an evaluator is the same candor a real buyer
would need. What must not happen is the two registers alternating paragraph by
paragraph, which is what the landing page does today. The rule: pages state the
product first and the project's real status plainly, in a designated place, in
the same voice — never as a disclaimer in small print, never as an apology.

## Positioning

**Category.** A help desk for internal requests, for organizations that have
more than one place, more than one team, and often no formal support department.

Not an ITSM suite: there is no CMDB, no change management, no SLA engine, and
claiming otherwise would be the kind of category inflation this project exists
to avoid.

**The central problem.** Requests arrive as signals — a WhatsApp message, a
phone call, somebody leaning over a desk. A signal carries real information and
none of the structure needed to act on it: no place, no owner, no history, no
ending. So the work gets done by whoever happens to be remembered, and a week
later nobody can answer what was open, who had it, or how long it took.

**The promise.** _Every request gets a place, an owner and an ending._

**The differentiation**, in the order it is defensible:

1. **Operational context is a first-class citizen, not a custom field.** Branch,
   department and service point are modelled entities with real foreign keys
   rather than free text. A ticket carries its branch and service point,
   validated when it is created, and **branch is a visibility input** — a branch
   manager sees the branches they cover. Most tools in this category offer
   "categories" and a text field. (Departments are not a visibility input and a
   ticket does not carry one yet; see the deferred claims.)
2. **A support team is not a department, and the model says so.** The people
   who ask and the people who fix are modelled separately; a team's branch reach
   is an explicit join where no rows means organization-wide. Blurring the two is
   the mistake this project made once, caught, and documented under its original
   filename so the correction stays visible.
3. **The interface is shaped by permissions, and refusals are sentences.** One
   permission vocabulary is shared by the services and the browser; controls
   render from it; and because that snapshot can go stale, every refusal is
   written as a real message rather than treated as impossible.
4. **Honesty is enforced by tests.** Statuses are data in one module, pages
   render from it, and specs fail CI when a claim outruns the product.
5. **AI reads the repetitive part; a person decides.** Suggestions never change
   a ticket, every one is labelled with provider, model, latency and tokens, and
   the panel says out loud when no language model is connected.
6. **The requester closes their own request.** The person who reported it has
   the last word.

**Functional benefit.** You can answer what is open, who has it, where it
happened and how it ended — without asking anyone.

**Emotional benefit.** Calm. For the person who runs support, it is no longer
being the one who has to remember everything. For the person who asked, it is
having asked once.

**Positioning statement.**

> For organizations whose support requests arrive through WhatsApp, phone calls
> and hallway conversations, HelpDesk AI is a help desk for internal requests
> that gives every request a place, an owner and an ending. Unlike tools that
> treat location as a text field and automation as the point, it models where
> work happens and who resolves it, keeps every decision attributable to a
> person, and uses AI only to read the repetitive part.

### What HelpDesk AI is not

Say these plainly when they come up; never imply the opposite.

- Not a customer-facing support inbox or a CRM. The requester is a member of the
  organization.
- Not an ITSM suite. No CMDB, no change management, no SLA engine, no queues.
- Not a chatbot, and Helpi is not one either.
- Not an autonomous agent. Nothing in the product decides on its own.
- Not a messaging tool. It replaces WhatsApp as the _channel for requests_, not
  as a way for people to talk to each other.
- Not a hosted service today. Nothing is deployed anywhere.
- Not a company. There are no customers, no funding and no production users.

## Proof points

Every claim the brand makes must land on one of these. Each is verified against
the repository, and each names what a sceptic can check.

| Claim                                                            | What backs it                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant isolation is structural, not a filter in application code | `NOT NULL` tenant columns on seven tables since phase 7; a read that addresses a ticket takes the organization from the token before it addresses the row, so a permission bug produces an over-broad in-tenant read and never a cross-tenant one. **Not "every repository port"** — `commentsFor` and `historyFor` reach a ticket already scoped by its id and take no organization of their own |
| Authorization is permission-based end to end                     | One vocabulary in `libs/security` shared by services and browser; every grant path reads one derivation, so privilege cannot escalate through invitation, role change or import (9.14)                                                                                                                                                                                                            |
| Membership changes are attributable to a person                  | The unattributable operator endpoints were deleted rather than deprecated; ADR 0021's four rules read stored rows, and nobody administers their own membership (9.10)                                                                                                                                                                                                                             |
| Where work happens is modelled, not typed                        | Branches, departments and service points are real rows with real foreign keys inside organizations-service, and archive without cascading (9.5, 9.11). A **ticket** carries a branch and a service point, each validated at creation against a local projection — never a department: that column is deliberately not on a ticket yet (ADR 0022)                                                  |
| A support team is not a department                               | ADR 0022, `support_team_branches` where no rows means organization-wide (9.12), and the distinction written into the Organization screen itself (9.13)                                                                                                                                                                                                                                            |
| Invitations cannot be forged or replayed                         | `sha256` of the secret only, constant-time compare, single use via a conditional update, redemption and membership insert in one transaction (9.8)                                                                                                                                                                                                                                                |
| A cold service repairs itself instead of refusing work           | Subscribe-then-snapshot with last-write-wins on source timestamps; the integration spec deletes the durable queue, proves the events were discarded, shows a ticket refused, reconciles, shows it accepted (9.16)                                                                                                                                                                                 |
| AI never acts on its own                                         | Suggestions are staff-only, mutate nothing, are labelled with provider/model/latency/tokens, and the panel discloses when no model is connected                                                                                                                                                                                                                                                   |
| The claims are tested                                            | `product-status.ts` plus specs that pin the AI labels and assert none reads "Available"                                                                                                                                                                                                                                                                                                           |
| The work is verified, not asserted                               | Every sprint since the tenancy migration closed with the full gate plus nine integration suites against real PostgreSQL and RabbitMQ, each with a recorded green remote CI run id                                                                                                                                                                                                                 |

Two rules about using them. **Cite the mechanism, not an adjective** — "the
database refuses a row without a tenant" beats "enterprise-grade isolation", and
the repository's writing standard bans the second phrasing anyway. And **never
convert a proof point into a number that was not measured**: there are no
percentages, no time savings and no benchmark figures anywhere in this project,
and inventing one would cost more credibility than it could buy.

## Brand personality

HelpDesk AI is a competent, patient coworker. The one who writes things down,
tells you what will happen before it happens, and does not make you feel stupid
for asking.

| Trait             | What it means in practice                                | What it is not         |
| ----------------- | -------------------------------------------------------- | ---------------------- |
| Calm              | Nothing shouts, nothing flashes, nothing invents urgency | Not sleepy or passive  |
| Precise           | Names the branch, the code, the fifteen minutes          | Not pedantic           |
| Plainspoken       | The concrete noun over the abstract one                  | Not blunt or cold      |
| Honest to a fault | States the limit at the moment it matters                | Not self-deprecating   |
| Warm              | Written by a person, for a person                        | Not chummy, never cute |
| Organized         | Structure is the product, and the surfaces show it       | Not rigid              |

It should not feel like a gaming interface, a generic violet SaaS template, a
corporate banking portal, a childish chatbot, or an autonomous agent pretending
to run the company. The last one is worth stating as a design constraint rather
than a preference: this product's entire AI posture is that a person decides,
and an interface that behaves like an agent would contradict the code.

## Tone of voice

Ten rules. The first four are already visible in the product and should be
treated as the standard rather than an aspiration.

1. **Consequence before action.** "The code identifies this branch everywhere
   and cannot be changed later. The name can." Say what will be true afterwards
   before offering the button.
2. **Name what the product will not do, where it matters.** "We did not send
   this anywhere. Pass it on yourself." A limit disclosed at the right moment
   builds more trust than a capability announced at the wrong one.
3. **Prefer the concrete noun.** The code, the branch, fifteen minutes, two
   hundred rows. Not "your data", "the entity", "shortly".
4. **A refusal is a sentence, not a wall.** "You do not manage people here. Ask
   an administrator of your organization if you need access to the directory."
   Say what happened and what to do next.
5. **No adjective that cannot be measured.** If it cannot be checked in the
   repository, it does not belong in a sentence about the product.
6. **Numbers come from the repository or not at all.**
7. **Second person for instructions. First person only for the author**, on
   `/about`, where it is a person accounting for their own project.
8. **Never minimise with "just" or "simply".** The person reading is having a
   problem.
9. **Never apologise for a limit.** State it, then state the alternative.
10. **A status word is a status word.** "Available", "API ready", "Planned" mean
    exactly what `product-status.ts` says they mean, everywhere, forever.

## Vocabulary

### Approved

| English         | Spanish (es-AR)      | Notes                                                                                                |
| --------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| request         | pedido               | The **requester-facing** word for the thing you open                                                 |
| ticket          | ticket               | The **staff-facing** word for the same object                                                        |
| branch          | sucursal             | A place. Belongs to the organization                                                                 |
| department      | área                 | Where a **requester** works. Belongs to exactly one branch                                           |
| support team    | equipo de soporte    | The group that **resolves**. Organization-owned                                                      |
| service point   | puesto               | The UI word for the model's "station". Instances get real names — "caja 2", not "puesto operativo 2" |
| member          | miembro              |                                                                                                      |
| invitation code | código de invitación | Never "invitation link", never "sent"                                                                |
| suggestion      | sugerencia           | What the AI produces. Never "decision", never "action"                                               |
| organization    | organización         | The tenant                                                                                           |

The **request/ticket split is deliberate and is now a rule**, not the accident it
currently reads as. A requester opens a request; staff work a ticket; they are
the same row. It respects that the word "ticket" is jargon to somebody who just
wants their printer fixed, and it matches the split the product already stumbled
into ("Go to requests", "any request you opened yourself").

**Role labels** follow `ROLE_LABELS` in `apps/web/src/lib/people.ts`: Owner,
Administrator, Branch manager, Service desk manager, Team manager, Technician,
Employee, Auditor. Proposed Spanish: Titular, Administrador, Responsable de
sucursal, Responsable de mesa de ayuda, Responsable de equipo, Técnico, Empleado,
Auditor.

**The stored keys are never translated and never renamed.** `requester`,
`agent`, `organization_admin` and the rest are values in
`memberships.role_template` and `invitations.role_template`; renaming one is a
data migration bought for a cosmetic (9.14). The label layer exists precisely so
the words can change without the data changing — the file comment says so, and
that seam is what makes Spanish possible at all.

### Rejected

**Category inflation:** enterprise-grade, world-class, revolutionary,
cutting-edge, next-generation, best-in-class, robust, scalable, production-ready.
The repository's writing standard already bans most of these; the brand extends
the ban to marketing surfaces.

**Empty verbs:** streamline, empower, unlock, supercharge, transform your
workflow, effortless, seamless. None appears as marketing filler anywhere in the
web source. The one literal hit is "the account was unlocked" describing an
account in the sample conversation, which is the concrete-verb usage this rule is
not aimed at — worth stating, because "verified by grep" invites a grep that
would otherwise fail on day one. Keep it that way.

**AI overstatement:** AI-powered, powered by AI, AI-driven, smart (as an
adjective for a feature), intelligent (as a product descriptor), automatically
resolves, self-healing (of anything a user sees), autonomous. The sanctioned
phrasing for a built-but-not-enabled capability is ADR 0009's: **built,
reachable, and not turned on.**

**Words that describe things we do not have:** queue, SLA, escalation policy,
workflow automation, routing rules, dashboard, 24/7, uptime, instant, real-time
(for anything that is not), sent (of an invitation), emailed.

**Words that break the model:** "department" for a support team or vice versa;
"agent" as an interface word (the label is Technician); "end user" (the label is
Employee); "chatbot", "assistant", "copilot" or "ask" for Helpi.

**Spanish specifically:** no vosotros, no peninsular "incidencia", no "usted" in
product UI (the product uses vos), no "reclamo" for a request (it means
complaint), no slang. Voseo is a register, not slang — the writing standard's
rule against imitating a human with slang and inconsistent formatting is not in
tension with it, and this sentence exists so nobody reads it that way.

## Visual direction

Sprint 10.1 implements this. Sprint 10.0 decides it and supplies the
measurements.

### The thesis: ink acts, yellow marks, chroma states

Three colour families, three jobs, no overlap.

- **Ink acts.** The interactive colour is near-black on light and near-white on
  dark. Buttons, links, focus rings.
- **Yellow marks.** `#FFEE8C` is the signature. It marks where you are (the
  active nav marker, the section eyebrow dash), what is ours (the mark, the
  Helpi launcher), and nothing else. It never carries text and never carries
  information alone.
- **Chroma states.** Blue, amber, green and red belong to ticket status and
  priority. They are the only colours in the system permitted to mean something.

### Why indigo leaves, and what I considered

The action colour today is `#4f46e5` — Tailwind's indigo-600, on Tailwind's zinc
neutrals, under a preflight the file itself labels as kept from the original
scaffold. It does its job well (6.02:1 as accent text on the light background,
6.67:1 on the dark one — I re-measured both and the documented figures are
correct). It is also the most common accent in the category, and the substrate
under it reads as template to anyone who has seen Tailwind defaults.

The constraint that decides this is not taste. The status palette already spends
blue, amber, green and red on ticket state and priority; the brand spends pastel
yellow. A chromatic action colour has to fit in whatever is left without
colliding with a state — which is how indigo ended up adjacent to the open-blue
`#1d4ed8` in the first place. **An achromatic action colour collides with
nothing, and it leaves the yellow as the only chroma in the interface that means
"brand" rather than "state".** That is a system, not a mood board.

_What I considered and did not choose._ A deep teal was the strongest chromatic
alternative — it is genuinely distinct from indigo and complements the yellow —
but it sits next to the resolved-green `#166534` and would have made "resolved"
and "primary action" cousins. A warm brown or ochre reads as the same family as
the brand yellow and would have muddied it. Keeping indigo and shifting the hue
was the cheapest option and fails the sprint's only aesthetic requirement.

_What this direction costs, stated honestly._ Ink buttons on warm neutrals is
itself a recognisable 2025 look. The differentiation here is not the ink — it is
the yellow's job and the warm paper it sits on. If 10.1 implements the ink and
skips the neutral shift, this direction will have bought nothing.

### The consequence for links

With an achromatic action colour, an inline link cannot be distinguished by
colour. **Inline links are therefore always underlined.** This is a gain: the
system already refuses to convey status by colour alone, and this extends the
same principle to interaction.

### Verified values

Measured with the WCAG 2.x relative-luminance formula. These are the anchors
10.1 builds the full ramp from — not the full ramp.

**Light — warm paper**

| Role                     | Value     | Measured                                                |
| ------------------------ | --------- | ------------------------------------------------------- |
| `--bg` page              | `#faf9f5` | L\* 97.9                                                |
| `--surface` cards        | `#ffffff` | L\* 100                                                 |
| `--text` ink             | `#1a1a17` | 16.56:1 on page, 17.44:1 on card                        |
| `--text-secondary`       | `#55534c` | 7.31:1                                                  |
| `--surface-2` hover fill | `#f2f0e9` | L\* 94.8                                                |
| `--text-muted`           | `#6a6860` | 5.30:1 on page, 5.58:1 on card, 4.90:1 on `--surface-2` |
| `--border-control`       | `#8a867c` | 3.63:1 on card, 3.45:1 on page, 3.19:1 on `--surface-2` |
| `--accent` action        | `#1a1a17` | ink; paper text on it                                   |

**Dark — warm ink**

| Role                     | Value     | Measured                                                 |
| ------------------------ | --------- | -------------------------------------------------------- |
| `--bg`                   | `#0d0c0a` | L\* 3.3                                                  |
| `--surface`              | `#171613` | L\* 7.3                                                  |
| `--surface-2` hover fill | `#211f1b` | L\* 11.8                                                 |
| `--text` paper           | `#f5f3ed` | 17.62:1 on bg, 16.31:1 on surface                        |
| `--text-secondary`       | `#a8a49a` | 7.86:1                                                   |
| `--text-muted`           | `#8d8980` | 5.61:1 on bg, 5.19:1 on surface, 4.72:1 on `--surface-2` |
| `--border-control`       | `#726e64` | 3.85:1 on bg, 3.56:1 on surface, 3.24:1 on `--surface-2` |
| `--accent` action        | `#f5f3ed` | paper; ink text on it                                    |

**Brand — identical in both themes, which is the whole point**

| Role         | Value     | Measured                                                                 |
| ------------ | --------- | ------------------------------------------------------------------------ |
| `--brand`    | `#ffee8c` | **1.12:1 as text on the light page — this is why it never carries text** |
| `--brand-on` | `#1a1a17` | 14.83:1 on `--brand`, in both themes                                     |

The yellow staying one value in both themes is what lets the mark, the launcher
and the markers be one asset instead of two. It is also why the logo needs no
light and dark variant.

### The focus ring inverts with its surface

Ink ring on light surfaces, paper ring on dark ones, always with an offset so the
ring sits on the background rather than on the control. Measured: 16.56:1 on the
page, 15.30:1 on a sunken band, 17.62:1 on the dark background, and 16.26:1 on
the contained dark CTA panel — the panel that today has to rebind `--accent` by
hand because the inherited indigo ring measured 2.87:1 there. **Inversion turns
that exception into the rule**, which is the second-best outcome of this
direction after the palette itself.

### Section banding must be re-tuned, and here is why

The existing bands are tuned in L\* because WCAG ratios compress uselessly near
white. Warming the base neutral breaks the existing tinted band: `#faf6e6` sits
1.1 L\* from a warm `#faf9f5` page, and the design system's own finding is that
1.7 L\* is imperceptible.

**Measure against the neighbour, not against the base.** My first re-tune
measured every band against `--bg` and passed, and it was wrong: it put sunken
at 94.8 and tinted at 94.0, which are **0.79 L\* apart** — and those two are
adjacent in the shipped layout, because `.technical` renders on
`--surface-sunken` and the landing page orders its sections
`raised → sunken → raised → technical → tinted`. That re-tune would have
reintroduced the exact Sprint 7.6 defect the banding system exists to prevent,
on the landing page, in a table asserting it did not. The set below is measured
against every adjacency the layout actually produces.

| Band   | Light     | L\*  | Dark      | L\*  |
| ------ | --------- | ---- | --------- | ---- |
| base   | `#faf9f5` | 97.9 | `#0d0c0a` | 3.3  |
| raised | `#ffffff` | 100  | `#1a1814` | 8.3  |
| sunken | `#f5f3ec` | 95.8 | `#050505` | 1.4  |
| tinted | `#f2e9cd` | 92.4 | `#221e14` | 11.4 |

Rendered adjacencies, light: raised↔sunken **4.2**, sunken↔tinted **3.4**.
Dark: base↔raised **5.0**, raised↔sunken **7.0**, sunken↔tinted **10.0**. Muted
text holds on every band — 5.03:1 and 4.60:1 in light, 5.85:1 and 4.77:1 in
dark.

**The dark theme is not the hard case; it is the easy one, and I had that
backwards.** The shipped dark bands separate by 5.98 to 7.37 L\* on every
rendered adjacency — the largest separations in the system — because
`--surface-raised` and `--surface-tinted` were lifted well clear of the
compressed region below L\* 4 rather than kept inside it. The `--section-border`
hairline reinforces those deltas; it does not carry them. 10.1 keeps that
technique.

**Two rules that follow, so nobody re-derives the mistake.** `.technical` shares
`--surface-sunken` and is therefore not a separate level — give it one in 10.1
or keep counting it as sunken. And **the order of tones on a page is part of the
design system**: not every pair in the set is ≥3 L\* apart (base and raised are
2.1, and cannot both be near white and further), so a new page that introduces a
new adjacency has to be re-measured rather than assumed.

### Depth, density, motion, illustration

- **Paper, not glass.** Prefer hairlines and surface levels over shadow. The
  two-layer soft shadows stay for genuinely floating things (the Helpi panel, a
  dropdown) and come off cards.
- **Density stays comfortable.** Single column, cards, no data tables. The daily
  user is a person on a shop floor, not a power user with a wide monitor.
- **Motion principles are unchanged and correct**: 150–200ms, `--ease-out`,
  everything inside `prefers-reduced-motion: no-preference`, no information
  conveyed by motion alone. One addition: **motion confirms a change the user
  caused, and never attracts attention on its own.** Nothing pulses to be
  noticed.
- **Illustration stays honest.** Product scenes composed from real primitives,
  plus the engineering-grid diagram style. No stock illustration, no 3D, no
  mascot, no faces.
- **Accessibility rules that are not negotiable, restated so a palette change
  cannot quietly drop one:** accent-as-text ≥4.5:1 in both themes; muted text
  ≥4.5:1 on every surface it can land on; control borders ≥3:1 (WCAG 1.4.11);
  the focus ring ≥3:1 against whatever it sits on, including the dark CTA panel;
  the brand colour never as text on a light surface; no status conveyed by
  colour alone.

### The mark

The current mark is a rounded square filled Tailwind indigo carrying a white
Lucide ticket outline, and it contains none of the yellow that makes the identity
recognisable. There is also a second, unrelated favicon in the public directory —
navy and steel blue, left over from the Nx scaffold — so the product currently
ships two different tab icons depending on which one a browser resolves.

Direction for 10.1, as constraints rather than a drawing:

- The mark is a **yellow field carrying an ink glyph** — the one pairing this
  system has already proven at 14.83:1, and the only one that needs no light and
  dark variant.
- It must read at 16px.
- It must not be verbatim Lucide path data, a speech bubble, a sparkle, or a
  ticket on a rounded tile.
- `apps/web/public/favicon.ico` is deleted, not restyled. One mark, one source.

**The wordmark stops colouring "AI".** Today "AI" is the only accented word in
every header and footer — the visual place of honour given to the least available
part of the product. Renaming the product is out of scope and would be expensive
(the name is in the package scope, storage keys, CI and every document). The
answer is to stop amplifying it: one ink weight across the wordmark, the yellow
mark carries the identity, and the AI claim always travels with its status.

## Helpi

Helpi as built is already the personality this strategy describes. The behaviour
needs nothing; the language needs everything.

### Keep exactly as is

A disclosure and not a dialog: no focus trap, no `aria-modal`, nothing blocking.
It never steals focus, auto-opens once on a first desktop visit and never on a
small screen, hides while an input has focus, yields to a tap outside or any
scroll, disappears under the mobile menu, and its dismissal is remembered but
reversible from the footer. Blocked storage degrades to "the choice is not
remembered", never to "the guide is gone".

There is no text input and there never will be. The disclaimer line stays. The
compass stays — orientation, not conversation — and `SparklesIcon` stays reserved
for the AI features.

### What Helpi is

Friendly, patient, approachable, useful, calm. It is the coworker who notices you
are new to a screen and says one useful thing, then stops talking. It tells you
where you are, what information is needed, what happens next, how to write a
request somebody can act on, and how roles and support flows work.

It writes naturally in es-AR with voseo, and it is adaptable to en-US later.
Never robotic, never childish, and never presented as an autonomous agent.

### What Helpi is not, and must not resemble

Not AI, not a chatbot, not an assistant, not a copilot. It answers nothing
because it is asked nothing — every string is authored by hand and selected by
route.

Visually it must not resemble a chat widget, a mascot with a face, an animated
character, a sparkle, or a speech bubble. This is the sharpest visual problem it
has: a floating circle in a bottom corner is the universal silhouette for "chat
with us", which is exactly the thing it refuses to be. Making the difference
legible at a glance — through the mark, the launcher's shape and the panel's
first line — is real work for 10.1, and it is more important than any other Helpi
change.

### The voice, with worked examples

Current hints are honest and terse. The rewrite keeps the honesty, which is the
differentiated trait, and adds the warmth that is missing — without adding
length, because the ~90-character budget is spec-enforced and Spanish runs longer
than English.

| Route           | Today                                                                            | Proposed es-AR                                                              |
| --------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `/`             | "I'm Helpi. I can show you how HelpDesk AI works."                               | "Soy Helpi. Te muestro cómo funciona HelpDesk AI."                          |
| `/how-it-works` | "A ticket is simply a request for help that stays organized."                    | "Un ticket es un pedido de ayuda que queda ordenado."                       |
| `/security`     | "These are real engineering decisions, not certifications."                      | "Son decisiones de ingeniería reales, no certificaciones."                  |
| `/contact`      | "This form prepares a message — it does not send one."                           | "Este formulario prepara un mensaje: no lo envía."                          |
| `/tickets/new`  | "Describe the problem in your own words. Priority helps the team triage."        | "Contá el problema con tus palabras. La prioridad ayuda a ordenar."         |
| `/people`       | "Invite a colleague, then hand them the code yourself — we do not email it."     | "Invitá a alguien y pasale el código vos: no lo mandamos por mail."         |
| `/join`         | "Paste the code you were given. You will see who invited you before you accept." | "Pegá el código que te dieron. Vas a ver quién te invitó antes de aceptar." |
| `/organization` | _(nothing — see the defect below)_                                               | "Acá definís sucursales, áreas y equipos de soporte."                       |
| disclaimer      | "Short written hints — not a chatbot."                                           | "Ayudas escritas y breves — no es un chat."                                 |

Two voice decisions this settles. **Helpi's "I" is only ever Helpi.** On
`/about` the current hint says "Why I built this, in my own words", where the "I"
is the author — two first persons in one guide. Helpi points at the author
instead: _"Acá te cuenta por qué lo hizo, con sus palabras."_ And **the chrome
strings are part of the voice**: "Don't show again", "Close Helpi", "Show Helpi
again" and the accessible name all get rewritten with the hints, not after them.

### Rules for whoever edits Helpi next

- Never promise a capability `product-status.ts` marks below `available`.
- Never invite conversation, in either language. The spec's English blacklist
  needs Spanish equivalents in the same change: `preguntame`, `chateá conmigo`,
  `asistente de IA`, `potenciado por IA`.
- The spec regexes are English-bound and must be rewritten alongside the copy, in
  the same commit, or the suite will pass while asserting nothing.
- Silence beats guessing on an unknown authenticated route. Fix the
  implementation to match that rule rather than softening the rule.

## The core idea: from signal to resolution

### What a signal is

A signal is the first, informal indication that something is wrong, in the form
it actually arrives: a WhatsApp message, a phone call, somebody catching you in a
corridor. It carries real information and none of the structure needed to act on
it. "The till isn't working" is a signal. It has no place, no owner, no history
and no ending.

### What the product does to it

It turns a signal into a **request**: a description in the person's own words, a
place (the branch, and the service point inside it), a priority, a requester
with a real identity, and a record that starts the moment it is created. The
requester's own department is not on the request yet — it is modelled, and
putting it on a ticket is deferred work, not a claim. Then it puts that
request where somebody is responsible for it — routing to a support team whose
reach is explicit — and keeps every step attributable: who changed the status,
who commented, who assigned, who resolved.

AI's contribution is bounded and should always be described the same way: it
reads the repetitive part — summarising a long thread, proposing a category or a
priority, drafting a reply — and a person decides. It never changes the request.

### What "resolution" promises, and what it must not

Resolution means the request reached an end that somebody decided and everybody
can see. **It does not promise automation, speed, or that the platform resolves
anything.** The platform routes, records and makes findable; people resolve. The
requester confirms.

That distinction is the difference between a claim this product can defend and a
claim it cannot. Any use of the phrase that implies the software does the
resolving is a misuse.

### The Spanish

Not a translation. "De la señal a la resolución" is awkward in Spanish and
"señal" reads as phone reception or a road sign before it reads as this.

**"De un aviso suelto a un problema resuelto."**

An "aviso suelto" is exactly the thing: a heads-up that reached somebody and
landed nowhere. The internal rhyme (suelto / resuelto) makes it hold together the
way the English alliteration does, and it stays concrete. Short form for tight
spaces: **"Del aviso a la resolución."**

### Where it belongs, and where it does not

**Use it** as the brand line: the About page's framing, the how-it-works opening,
the social preview image, the footer. Sparingly — a line used everywhere stops
being a line.

**Do not use it** next to an AI capability (it would read as a claim about
automation), on or near a status pill, as a page title, in product microcopy —
the product speaks in concrete nouns — or anywhere it could be read as a
description of what the software does by itself.

**Two collisions to clear in 10.1.** The landing page already has the section
heading "From request to resolution, with people in charge", which is a category
cliché and would compete directly; it goes. And the hero's sample ticket is
"Projector in room 4B shows no signal" — an accident that will read as
deliberate repetition once the line ships. Change the sample.

## Tagline architecture

Four near-taglines coexist today: "Support operations, improved by artificial
intelligence" (hero and footer), "Intelligent support operations" (root
metadata), "Support operations, improved by AI" (landing title) and "AI-assisted
support" (the authenticated app footer). None of them is wrong in the same way,
which is the problem. Five slots replace them.

| Slot            | Line                                                                                                         | Where                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Name**        | HelpDesk AI                                                                                                  | Unchanged. Wordmark in one ink weight                                            |
| **Descriptor**  | Help desk for internal requests · _Mesa de ayuda para pedidos internos_                                      | Metadata, tab titles, footer, anywhere the category must be stated in five words |
| **Promise**     | Every request gets a place, an owner and an ending · _Cada pedido tiene un lugar, un responsable y un final_ | The hero. The one line that does the selling                                     |
| **Brand line**  | From signal to resolution · _De un aviso suelto a un problema resuelto_                                      | Rare and high-level: About, how-it-works opening, social preview                 |
| **Status line** | Portfolio project · in active development                                                                    | Wherever claims are made. Never removed, never shrunk into a disclaimer          |

The descriptor deliberately does not lead with AI. The product's available
capabilities are requests, structure, permissions and people; the AI is the least
available part, and leading with it is the overstatement the wordmark currently
makes visually.

## Spanish and English

**Today there is no Spanish rendered anywhere.** `lang="en"` is hard-coded in
the root layout, there is no i18n configuration, and every string is a literal
in a component.

**There are two translation-ready seams, and the second one surprised me.** In
the browser, `ROLE_LABELS` separates the product's words from the stored keys and
its own comment says that is what makes them translatable later. Behind it, and
already carrying data, users-service stores organization-defined profile field
labels as a locale pair — `label_es_ar` and `label_en_us`
(`apps/users-service/prisma/schema.prisma`) — which Sprint 9.6 recorded as
deliberate preparation so that i18n would be "content, not schema churn".
Nothing in `apps/web` reads the es-AR column yet, so the seam is built and
unconsumed.

That matters for scoping: part of this decision was already taken in 9.6 and is
waiting rather than open. Bilingual delivery is still architecture work rather
than copywriting.

**The scope was settled by the project owner at the start of Sprint 10.1, and
this paragraph records the answer rather than the question.** **es-AR is the
product's primary language.** en-US remains a planned supported language, and
**complete internationalization is Sprint 10.9** — so 10.1 made the system
structurally safe to localize and translated only Helpi, which is the voice in
its most concentrated form, one file, and spec-guarded. The rest of the product
stays English until the machinery exists to keep two languages in step;
half-translating ahead of that is how a half-translated interface happens.

The principles below were written to hold under any of the three possible
answers, and they hold under this one unchanged.

**Principles.**

1. **Neither language is a translation of the other.** Both are written; the
   meaning is shared, the phrasing is native. A Spanish string that reads as
   translated English has failed even when it is accurate.
2. **Spanish is rioplatense, with voseo, in the product's own voice.** Contá,
   pegá, invitá, definís. Not vos-as-a-gimmick — vos because that is how the
   product's first users speak.
3. **The register stays professional in both.** Voseo is a register, not slang;
   the writing standard's ban on slang and manufactured informality still holds.
4. **Stored values are never translated.** Role template keys, permission keys,
   event names, status enums. Only labels move.
5. **The vocabulary table is binding in both languages.** A support team is
   never an "área"; a department is never an "equipo".
6. **Both languages carry the same claim.** If a capability is API ready in
   English it is API ready in Spanish, with the same status word, from the same
   source of truth. A status pill that only renders honestly in one language is
   a bug.
7. **Length is a design constraint, not an afterthought.** Spanish runs 15–25%
   longer; Helpi's ~90-character budget and every button label must survive it.

## Example copy

Illustrative, for 10.1 to work from. Both languages, same meaning, native
phrasing.

### Public headlines

| Slot          | Today                                                                      | Proposed EN                                                                                                                                                                                   | Proposed ES                                                                                                                                                                                                    |
| ------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero H1       | "Support operations, improved by artificial intelligence."                 | "Every request gets a place, an owner and an ending."                                                                                                                                         | "Cada pedido tiene un lugar, un responsable y un final."                                                                                                                                                       |
| Hero lead     | "Centralize requests, assist support teams, automate repetitive analysis…" | "Support requests arrive by message, by phone, or in a hallway. HelpDesk AI turns them into requests with a place, a team and a history — and the person who asked confirms when it is done." | "Los pedidos de soporte llegan por mensaje, por teléfono o en un pasillo. HelpDesk AI los convierte en pedidos con un lugar, un equipo y un historial — y la persona que pidió confirma cuando está resuelto." |
| Who it serves | "One platform, four jobs done well"                                        | "Four people, one request"                                                                                                                                                                    | "Cuatro personas, un mismo pedido"                                                                                                                                                                             |
| Capabilities  | "Everything a support operation needs"                                     | "What works today, labelled"                                                                                                                                                                  | "Lo que funciona hoy, con su etiqueta"                                                                                                                                                                         |
| Workflow      | "From request to resolution, with people in charge"                        | "A signal becomes a request"                                                                                                                                                                  | "Un aviso se convierte en un pedido"                                                                                                                                                                           |
| Security      | "Built like it holds real data"                                            | _keep_                                                                                                                                                                                        | "Construido como si guardara datos reales"                                                                                                                                                                     |
| Status        | "Exactly where the project stands"                                         | _keep, and make it true_                                                                                                                                                                      | "Exactamente en qué punto está el proyecto"                                                                                                                                                                    |

### Product microcopy

The rule these demonstrate is consequence-first. The first three exist in the
product today and are the standard.

| Situation                   | EN                                                                                                                                             | ES                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creating a branch code      | "The code identifies this branch everywhere and cannot be changed later. The name can."                                                        | "El código identifica esta sucursal en todos lados y no se puede cambiar después. El nombre sí."                                                                     |
| After issuing an invitation | "We did not send this anywhere. Pass it on yourself, and keep it private — anyone holding it can join."                                        | "No lo mandamos a ningún lado. Pasalo vos y guardalo bien: cualquiera que lo tenga puede entrar."                                                                    |
| A membership change         | "A membership change applies the next time they sign in or their session refreshes — up to fifteen minutes."                                   | "Un cambio de rol o de estado se aplica la próxima vez que inicien sesión o se renueve la sesión — hasta quince minutos."                                            |
| Empty support teams         | "No support teams yet. Create one for each group that resolves tickets — one central team is enough to start, and it will serve every branch." | "Todavía no hay equipos de soporte. Creá uno por cada grupo que resuelve tickets — con un equipo central alcanza para empezar, y va a atender todas las sucursales." |
| Refusal                     | "You do not manage people here. Ask an administrator of your organization if you need access to the directory."                                | "Acá no administrás personas. Pedile acceso al directorio a un administrador de tu organización."                                                                    |
| AI panel                    | "Suggestions for you to review. Nothing here changes the ticket, and nothing runs until you ask for it."                                       | "Sugerencias para que revises. Nada de esto cambia el ticket, y nada se ejecuta hasta que lo pidas."                                                                 |

## Claims

### What may be claimed now

Ticket lifecycle with priorities, comments, internal notes and full history.
Requesters confirming and closing their own requests. Branches, departments and
service points, created and archived from the product — **not the organization
itself**, which is created by migration and can be neither renamed nor archived
from anywhere in the UI.
Permission-based authorization with eight role templates and scoped visibility.
Member administration with attributable changes. Invitations as single-use codes,
**handed over by the administrator**. CSV import that issues invitations.
Profiles with organization-defined fields. Shared-terminal login posture. Support
teams and manual routing to them. Tenant isolation enforced in the database.
Projection reconciliation for tickets-service. Structured logs, request
correlation and health endpoints.

Two conditions on all of it. Every claim carries the status
`product-status.ts` gives it — **and that file is four sprints stale, so it must
be refreshed before any of these are said louder than they are said today.**
And every claim sits beside the status line: nothing is deployed.

For AI, the only sanctioned phrasing is the accurate one: four capabilities are
**built, reachable, and not turned on** — implemented behind the gateway with a
staff-only UI and a Gemini adapter verified locally, needing per-deployment
provider credentials. Duplicate detection is planned. Saying "planned AI"
understates it and "AI-powered" overstates it.

### What must stay deferred

Email delivery of anything. Automatic routing rules, queues and escalation.
Dashboards and any analytics UI. Notification and audit-browsing UIs. The
assignee picker. Categories, attachments, duplicate detection. Custom roles.
Self-serve organization onboarding — the first administrator of a fresh database
is still made in SQL. Ownership transfer and renaming an organization. SSO, SCIM,
billing. Instant revocation: the window is up to fifteen minutes and the copy
already says so. Any certification, compliance programme or independent
penetration test. Anything implying hosting, uptime, customers, pilots run, or
scale — there is no load testing, no backup and restore story, no metrics or
alerts, one person has reviewed the security, and browser coverage is Chromium
only.

## Truth defects found during this sprint

Recorded here with evidence; **fixed in 10.1**, not in 10.0, because every one of
them changes a rendered page or a public claim and this sprint writes no UI. The
exceptions are three documentation corrections applied in this sprint's commits
and noted in the sprint record.

1. **`product-status.ts` is four sprints stale.** Support teams still reads
   api-ready with "the screen for it is planned"; the screen shipped in 9.13.
   CSV import, org-defined profile fields, shared-terminal sessions and
   projection reconciliation have no entry at all. The landing page's
   "Implemented" list stops around 9.0. ADR 0009 commits that list to being kept
   in sync with `docs/progress`; it is not. **This is the first thing 10.1 does**
   — every other claim change depends on it.
2. **Six places hard-code an AI status**, against ADR 0009's rule that no page
   hard-codes one. Three are prose: the landing workflow step "AI analyzes —
   planned", the technicians card's "on the roadmap", and the root metadata
   description. The other three are worse and are easy to miss —
   `how-it-works/page.tsx` renders `<StatusPill status="api-ready" />` at lines
   243 and 262 and `<StatusPill status="planned" />` at line 268 as literals in
   the JSX rather than from `CAPABILITY_AREAS`. Those three will silently
   disagree with `product-status.ts` the moment step one of 10.1 changes an AI
   status. (The features page's legend is not one of these: it defines the
   vocabulary rather than claiming a capability's status. The security page has
   a seventh `StatusPill` literal, for the security roadmap rather than for a
   capability in `product-status.ts` — a different question, listed here so a
   grep does not turn it up as a surprise.)

   **ADR 0009 itself is stale on this point and should be amended with the
   fix.** It says "Landing, features and how-it-works all render from it";
   `how-it-works/page.tsx` imports `StatusPill` and imports nothing at all from
   `product-status.ts`, so it renders no status from the module. That is what
   makes its three literals possible, and it means the ADR's own claim needs the
   same correction the pages do.

3. **The authenticated app footer says "HelpDesk AI — AI-assisted support"** with
   no status qualifier — the one line in the product less honest than the
   product, in a shell whose own AI panel says "No language model is connected".
4. **The engineering page says organizations-service has "no product surface
   yet"**, which three shipped screens contradict, and lists five event
   contracts where the platform defines around twenty.
5. **`README.md` is stale by fourteen sprints** and repeats a containment claim
   that ADR 0019 reversed. It is the most-read surface of this project and is
   subject to the same status discipline as the site.
6. **Helpi's `/organization` hole.** An authenticated route falls through the
   prefix guard to the public marketing intro — the exact "guessing inside a tool
   someone is working in" its own code says it refuses to do. Its
   planned-capability spec guard also scans public routes only, so the one hint
   that mentions AI ("AI drafts for staff", stated in the present tense for an
   api-ready capability) is never checked.
7. **Two favicons.** `apps/web/public/favicon.ico` is Nx-scaffold artwork in navy
   and steel blue, unrelated to the indigo mark in `app/icon.svg`.
8. **No social preview image and no error surfaces.** Every shared link renders
   without an image, and there is no `not-found.tsx` or `error.tsx` anywhere, so
   404s and crashes fall back to unbranded framework defaults.
9. **Role vocabulary drift**: the landing says "End users" where the settled,
   spec-guarded label is "Employee".
10. **`helpi-hints.ts` carries a stale load-bearing comment** claiming the whole
    public site marks AI as planned. A future editor could tighten the wrong
    constraint from it.

Applied in 10.0 as documentation corrections, in three files. `SECURITY.md` — it
said `INTERNAL_SERVICE_TOKEN` opens "two read-only membership lookups and nothing
else" and "guards no mutation anywhere in the platform", both false since 9.16,
and exactly the kind of overstatement the security page says makes a security
page a vulnerability; the header's sprint range went from 9.8 to 9.16 with it.
`frontend-design-system.md` — the stale Helpi path and public-only framing.
`product-vision.md` — labelled as the Sprint 1 document it is, and pointed at
`product-status.ts` for capability questions and here for phrasing.

## What this means for Sprint 10.1 and later

**10.1 — the design system.** In this order: refresh `product-status.ts` first,
because every claim depends on it, and amend ADR 0009 with it — the ADR names
`how-it-works` among the pages that render from the module, and it does not; then the token layer (warm neutrals, ink
action colour, focus-ring inversion, re-tuned bands), re-measuring every ratio in
this document rather than trusting it; then the mark and the wordmark, and delete
the scaffold favicon; then underlined inline links; then the four competing
taglines replaced by the five-slot architecture. The neutral shift is not
optional — ink without warm paper buys nothing.

**Later Block B sprints, in the order the audit suggests:**

- **The public site rewrite.** The multi-tenant story — branches, departments,
  support teams — is the product's actual shape and appears nowhere in public
  prose. Fix the six understatements at the same time.
- **Helpi's Spanish.** Copy, chrome strings and specs in one change; the
  `/organization` hole and the spec-guard gap with them.
- **The bilingual decision and its architecture**, whatever scope 10.1's
  Definition of Ready sets.
- **The missing surfaces**: a social preview image, `not-found.tsx`, `error.tsx`.
- **The Account screen**, which leaks raw role keys and is the one place the
  vocabulary layer breaks.
- **Organizational onboarding**, where the brand's promise meets the fact that
  the first administrator is still made in SQL.

None of this touches Block A's deferred work, which stays where it is recorded in
`pilot-readiness.md` and the handoff. Email delivery in particular remains the
project owner's decision under ADR 0008, and nothing in this document
pre-announces it.

## What I would revisit before treating this as settled

The accent-colour direction is the one call here that a different person could
reasonably make differently. The reasoning is structural — the status palette
already spends every chromatic slot — but "achromatic action colour" is a
conclusion drawn from a constraint, not the only conclusion available from it. It
is cheap to redirect at 10.1's Definition of Ready and expensive to redirect
after the token layer ships, so that is the moment to disagree with it.

The bilingual scope is deliberately unanswered here for the same reason: it is
the only decision in this document with a large implementation cost and nothing
in the repository that settles it.
