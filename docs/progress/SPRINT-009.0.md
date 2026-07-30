# Sprint 9.0 — Close Sprint 8 and connect a model provider

Status: COMPLETE (2026-07-30), pending merge approval.

Goal: close the one thing Sprint 8 deliberately left open — the model
provider choice — and make the repository tell the truth about it. Sprint
8 shipped a provider port with a deterministic local adapter and said, in
writing, that connecting a real provider would be additive. This sprint
tested that claim and then fixed every document that still described the
world before it.

## What I chose

**Google Gemini**, via the Interactions API, default model
`gemini-3.5-flash-lite`. `local` stays the default and is what CI runs
on, so the test suite still needs no credential and no network.

I picked Gemini for two practical reasons rather than a benchmark: it has
a free tier that makes a portfolio project's spend predictable, and its
`response_format.schema` takes standard JSON Schema, which maps directly
onto the per-task output schemas this service already had. The older
`{model}:generateContent` surface would also have worked, but its
`responseSchema` accepts only an OpenAPI subset and would have needed a
translation layer between the domain schemas and the request.

No SDK. One HTTP call did not need a dependency, and what the adapter has
to satisfy is the port's contract, not a vendor client's ergonomics.

## Did the abstraction hold?

This was the actual test of ADR 0010, so it is worth being precise: the
Gemini adapter touched `env.ts`, `provider.factory.ts` and
`.env.example`, added one provider file, and ran the shared provider
contract suite against it — the five steps that ADR lists, plus specs.
**Nothing in the domain, the application layer, the controller, the BFF
or the UI changed**, and no dependency was added. The claim held.

One thing the original list got wrong: it said adding a provider was four
edits and forgot `.env.example`. I nearly shipped an undocumented
variable because of that, so ADR 0010 now lists five.

## What I did not do

Structured output is requested but still not trusted. The application
layer validates every answer against the domain zod schema exactly as it
did for the local provider. A model that returns a confident, well-formed,
wrong shape is rejected the same way it always was — that is the entire
reason validation lives outside the adapter, and connecting a real
provider was not a reason to relax it.

No retries. One attempt per call: a retry doubles the spend and the
latency of a request someone is waiting on, and retry policy belongs to
the platform, not to one adapter.

## Public status: API ready, not Available

Sprint 8's own plan said these capabilities should become `available`
once a provider was connected, reasoning that the panel exists. I
overturned that.

The panel does exist, but the capability answers nothing until the
operator supplies their own `GEMINI_API_KEY`, and none of this is
deployed anywhere. "Usable end-to-end in the product UI today" is not
true of a feature that needs a credential the reader does not have. So
the four capabilities are `api-ready`, and I widened what `api-ready`
means rather than inventing a fifth status — it now covers "built,
reachable, and not turned on", which has two shapes in this repository:
assignment (an API with no picker UI) and AI (an API and a UI that need
configuration). ADR 0009 records the amendment and why.

The wording used on the site: _"Gemini provider integration is
implemented and verified locally. Each deployment must configure its own
provider credentials before enabling these capabilities."_

Duplicate detection stays `planned`. It needs embeddings and similarity
search, and nothing about this sprint moved it.

## Security

- The key travels as an `x-goog-api-key` header, never in a URL — query
  strings end up in proxy logs and error reports.
- Every string that originates outside the process goes through `redact`
  before it can reach a message, log or thrown error. Two specs cover the
  plausible leak paths: a transport error echoing the request, and an
  upstream body quoting the key back.
- The key is required only when `AI_PROVIDER=gemini`, and startup fails
  fast naming the variable when it is missing or empty.
- **Ticket text now leaves the machine.** With `AI_PROVIDER=gemini` the
  title, description, public thread, status, priority and category are
  sent to Google. Internal notes are not, and cannot be: they are dropped
  before a provider context object exists. ADR 0011 states this plainly
  now, because it was written when the only provider was local and never
  had to answer the question.
- What is still missing, and what stands between `api-ready` and
  `available`: usage ceilings, key rotation, and rate limiting on the
  gateway and BFF. SECURITY.md lists all three as unbuilt.

## A real bug this sprint caught

`suggestions.controller.ts` imported `SuggestionOutput` from
`domain/suggestion.ts`, which only imported the type and never re-exported
it. That is a broken type-only export, and it passed `lint`, `test` **and**
`build` at HEAD: the jest transform (swc) strips types without checking
them, and webpack walks the entry graph only. `tsc --build` was the only
thing that saw it.

`pnpm typecheck` is now part of the gate for exactly this class of break.
The fix and the gate ship in the same commit, because adding the gate
without the fix would have made the commit red.

## Verification

- Full gate green: `format:check`, `lint`, `typecheck`, `test`, `build`
  across all 14 projects, plus the 8 integration suites against real
  PostgreSQL and RabbitMQ.
- `ai-service` unit specs went from 52 to 71 — 19 new across the Gemini
  adapter and the environment schema.
- `apps/web` stayed at 117 with 5 specs rewritten: the landing and
  how-it-works suites were written in Sprint 8 to fail until the site
  matched reality, and they did fail, which is the outcome that made them
  worth writing.
- The Gemini path itself was verified locally against synthetic tickets:
  all four tasks returned schema-valid output through
  `web → bff → gateway → ai-service → tickets-service`. No real ticket
  data was used, and the free tier was the only thing spent.
- No credential appears in tracked content or in the full git history.

## Documentation changed, and what came out of it

Connecting a provider falsified more prose than code. Removed or
corrected:

- `SECURITY.md` — "no key exists yet, so nothing about rotation, scoping
  or per-request budgets has been designed", which sat under a heading
  whose preamble says none of it is implemented. Some of it was.
- `ADR 0010` — "the model provider is not chosen yet" and "the only
  accepted value is `local`".
- `ADR 0011` — clarified that "no service credential" was always scoped
  to the ticket store, and added what is and is not sent to a provider.
- `ADR 0009` — the `api-ready` definition, plus a stale bullet claiming
  the specs pin every AI card to "Planned" (they had pinned "In
  development" since Sprint 8).
- `docs/architecture/system-context.md` — "**No external AI provider is
  connected**".
- `docs/architecture/service-boundaries.md` — "it is an open
  product-owner decision".
- `README.md` — AI "designed but not implemented", "Nine applications"
  (there are ten), and a stale sprint range.
- `docs/architecture/frontend-design-system.md` — Helpi's justification
  rested on the site labeling AI as `Planned`. The rule is right but the
  reason was rotting, so it now rests on something durable: Helpi is a
  public-site navigation aid, and the AI features are staff-only inside
  the authenticated product.

Code comments in the files this sprint touched got the same pass. Three
were worth fixing rather than tidying:

- `domain/suggestion.ts` cited **ADR 0005** as the source of the ticket
  priority vocabulary. ADR 0005 is about RabbitMQ and does not mention
  priorities; the real source is `tickets-service`'s domain module.
- `gemini.provider.ts` claimed every detail string passes through
  `redact`. Only the two derived from outside the process do — the other
  three are fixed literals. The security property holds, but the comment
  described enforcement that does not exist, which is how a future
  refactor introduces a leak while believing it is covered.
- The same file carried a request/response sketch duplicating the code
  below it, with nothing to keep the two in step.

Everything above describes work in this repository. Nothing in this
sprint's documentation claims a user, a customer, an incident or a
deployment that does not exist.

## Deliberately not done

- **Usage ceilings, key rotation, rate limiting** — named as the gap,
  not built. They are the work that would earn `available`.
- **Per-task model selection** — one model serves all four tasks. A
  summary and a reply draft plausibly do not want the same one, but
  nothing here needed it yet.
- **`docs/roadmap/PRODUCT-ROADMAP.md`** — not created. Writing it means
  publishing a forward plan, which is a product decision rather than a
  documentation chore, and this sprint had no mandate to make it.
- **The provider-notice failure path** — if `GET /ai/provider` fails, the
  panel shows an error and no provider notice at all, which quietly drops
  the "No language model is connected" disclosure instead of defaulting
  to the conservative message. Found while tracing the runtime messaging;
  it is a real gap, it predates this sprint, and fixing it was outside an
  approved commit.
