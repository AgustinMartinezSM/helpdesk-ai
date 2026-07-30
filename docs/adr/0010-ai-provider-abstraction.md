# ADR 0010 — AI provider abstraction with a deterministic local provider

- Status: Accepted
- Date: 2026-07-29
- Sprint: 8 (AI service)

## Context

Sprint 8 introduces `ai-service`, the first service in the platform whose
behavior depends on a large language model. Two facts shape the design.

First, **the model provider is not chosen yet** (it was chosen in Sprint
9.0 — see the update at the end). Connecting a paid provider is a
product-owner decision — it involves credentials, a cost model and a
data-processing relationship with a third party. That decision cannot be
made by the code.

Second, **the service still has to be real today**. A service that only
compiles is not a service: it needs a persisted domain, an HTTP contract,
authorization, error handling, tests that assert behavior, and a UI that
exercises it end to end. None of that should wait on a provider choice.

There is also a trap specific to LLM integrations: a model returns text,
and text is easy to store and display without ever checking it. That
produces a system whose data of record is whatever a remote model felt
like emitting — unbounded, unvalidated and untyped.

## Decision

### One narrow port, owned by the application layer

```ts
interface AiProvider {
  readonly id: string; // 'local', later 'gemini', ...
  readonly model: string; // 'heuristics-v1', later a model id
  run(request: AiTaskRequest): Promise<AiProviderOutput>;
}
```

`AiTaskRequest` carries the **task** (`summary`, `classification`,
`priority`, `reply`), the **structured ticket context** and explicit
**limits** (max output units, timeout). `AiProviderOutput` carries
`data: unknown` plus `model`, optional token `usage` and `latencyMs`.

The port receives structured context, not a prompt string. This is the
boundary that matters: **the application layer decides _what_ is asked
and validates the answer; the adapter decides _how_ to ask.** Prompt
templates are provider-specific formatting and live in infrastructure,
next to the adapter that uses them. A heuristic adapter that has no
prompt at all is therefore a first-class implementation, not a hack.

### The provider's answer is untrusted input

Every task has a zod output schema in the domain layer
(`suggestion-outputs.ts`). `data` is validated against the schema for
its task before anything is stored or returned:

- `classification.category` must be one of a closed vocabulary;
- `priority.priority` must be one of the ticket priorities;
- text fields have hard maximum lengths;
- `confidence` must be a number in `[0, 1]`.

A provider that answers off-schema produces `AiProviderOutputError` →
HTTP 502, and **nothing is persisted**. A hallucinated category cannot
enter the database, and a runaway response cannot bloat a row.

### Guardrails belong to the application, not the adapter

Truncation limits (per field, and a maximum number of thread messages),
the per-request timeout, and the one-attempt-no-retry policy are enforced
in `build-ticket-context.ts` and the use case, so every provider — today
and tomorrow — is bound by the same limits. An adapter cannot opt out of
them by forgetting to implement them.

**Internal notes are never included in the context.** Staff-only notes
are excluded before the context is built, so they cannot reach a third
party even though the service can read them (see ADR 0011).

### Failure is reported, never faked

If the selected provider fails, times out or answers off-schema, the
request fails with an explicit error. There is **no fallback to the local
provider**, because a caller who asked an LLM for a summary and silently
received a keyword heuristic has been misled about the nature of the
answer. The same reason is why the provider `id` and `model` are stored
on every suggestion and displayed in the UI.

### Selection and the extension point

`AI_PROVIDER` selects the adapter at bootstrap; an unknown value fails
env validation with a message naming the accepted values. The accepted
values are `local` and `gemini` (added in Sprint 9.0 — see the update at
the end of this ADR).

`local` is a deterministic keyword-and-template provider
(`heuristics-v1`): same input, same output, no network, no cost. It makes
the whole path testable in CI and gives the UI something real to render,
and it is labeled as itself everywhere it appears.

Adding a provider is five edits, and no change to the domain,
application layer, controller, BFF or UI:

1. add the provider id to the `AI_PROVIDER` enum plus its credential
   variables in `src/config/env.ts` (conditional: the key is required
   only when that provider is selected);
2. add `src/infrastructure/providers/<id>.provider.ts` implementing
   `AiProvider`;
3. register it in `createAiProvider` (`provider.factory.ts`);
4. run the shared provider contract suite against it
   (`src/infrastructure/providers/provider-contract.ts`) — a suite every
   adapter must pass, which asserts the port's promises rather than one
   adapter's implementation;
5. document the new variables in `apps/ai-service/.env.example`. This
   step was missing from the original list and Sprint 9.0 nearly shipped
   an undocumented variable because of it.

## Consequences

Positive:

- The provider decision stayed open without blocking a single line of
  the rest of Sprint 8, and closing it in Sprint 9.0 was additive. That
  is now evidence rather than a prediction: see the update below for what
  the Gemini adapter actually cost.
- Output validation makes the store's shape independent of model
  behavior: the database cannot hold something the domain does not
  recognize.
- Determinism in CI: no network, no spend, no flakes, and the contract
  suite is reusable evidence that a new adapter behaves.
- Cost controls (truncation, single attempt, timeout, staff-only access)
  exist before the first invoice, not after it.

Negative / accepted:

- The `local` provider's output is genuinely modest. That is a feature
  here — it is labeled — but it means that when `AI_PROVIDER=local` the
  UI's value is not really on display.
- A single-method port cannot expose provider-specific features
  (streaming, tool calls, embeddings). Streaming and embeddings are known
  future work: duplicate detection will need an embeddings port of its
  own, and that is deliberately out of this sprint.
- Prompts living in infrastructure means two adapters may word the same
  task differently. Accepted: the output schema, not the prompt, is the
  contract.

## Alternatives considered

- **Fat port with one method per capability** (`summarize`,
  `classify`, …): rejected — every new provider would have to implement
  four methods, and the shared guardrails would be re-implemented four
  times per adapter.
- **Text-completion port with parsing in the application layer**:
  rejected — it forces every adapter to answer in prose and pushes
  fragile parsing into the core, when modern providers can return
  schema-constrained JSON directly.
- **Wait for the provider decision before building the service**:
  rejected — it would leave the sprint with nothing to show and would
  concentrate all the risk (domain, persistence, authorization, UI,
  provider) into one later step.
- **Silently fall back to the local provider when the LLM fails**:
  rejected — it produces confident-looking output of a different nature
  than the one requested, which is exactly the failure mode the product
  claims to avoid.

## Update — Sprint 9.0: Google Gemini

The provider decision is closed. `gemini` calls Google's Interactions
API (`POST /v1beta/interactions`) with `x-goog-api-key`, defaulting to
`gemini-3.5-flash-lite`. `local` stays the default and is the provider CI
runs on, so the test suite still needs no credential and no network.

**What it cost.** The port's central claim was that adding a provider
would not touch the domain, the application layer, the controller, the
BFF or the UI. That held. The change was exactly the five edits listed
above — `env.ts`, the adapter, the factory, a run of the contract suite,
and `.env.example` — plus the adapter's own specs. Nothing else in the
service moved, and no dependency was added: one HTTP call did not need
an SDK.

**Why Interactions rather than `generateContent`.** Both are documented
and both would work. Interactions takes standard JSON Schema in
`response_format.schema` (`required`, `enum`, `anyOf`), which maps
straight onto the per-task output schemas this service already has;
`generateContent`'s `responseSchema` accepts only an OpenAPI subset, so
the same schemas would have needed a translation layer.

**What I did not do.** Structured output is requested but still not
trusted — the application layer validates every answer against the domain
schema exactly as it did for `local`. A provider that returns a
confident, well-formed, wrong shape is rejected the same way it always
was, which is the whole reason validation lives outside the adapter.

**What this opens that was not open before.** Ticket text now leaves the
machine (ADR 0011 records what is and is not sent). The service now holds
a credential of its own. And spend becomes real: usage ceilings, key
rotation and rate limiting are unbuilt, and they are the work standing
between `api-ready` and `available` (ADR 0009). One model serves all four
tasks today; per-task model selection is still open, and a summary and a
reply draft plausibly do not want the same one.
