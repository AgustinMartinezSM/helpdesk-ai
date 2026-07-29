# ADR 0008 — Contact delivery strategy

- Status: Accepted
- Date: 2026-07-29
- Sprint: 7.6 (Product Experience, Brand and Portfolio)

## Context

The public site needs a contact experience. The project has no email
provider, no transactional mail credentials and no budget decision to
adopt one; connecting a paid service or exposing personal credentials
requires explicit approval from the project owner.

A contact form that appears to send a message but silently discards it
is a lie told by the interface. On a site whose central claim is
"honest status labeling", that would undermine the whole product
argument — and it is exactly the kind of detail an interviewer probes.

Four options were considered:

- **A. Frontend-only validated form with explicit demo behavior.**
- **B. A local backend endpoint** that accepts and stores/logs the
  message.
- **C. A `mailto:` action** that hands the message to the visitor's own
  email client.
- **D. Deferred real delivery** with honest messaging until a provider
  exists.

## Decision

Adopt **A + C**: a fully validated client form whose success state is
explicit about what did and did not happen, with a `mailto:` handoff as
the real delivery path.

Concretely:

- The form validates name, email, subject and message (with an
  organization field and a reason select), reports field-level errors
  with `aria-invalid` + `aria-describedby`, announces a summary through
  `role="alert"`, and blocks duplicate submission.
- On success it renders, inside a `role="status"` region: _"this demo
  does not send messages to a server — there is no delivery backend
  behind this form, by design."_
- When `NEXT_PUBLIC_CONTACT_EMAIL` is configured, the success state
  offers **"Open in your email app"** — a prefilled `mailto:` built from
  the submitted values (subject prefixed with `[HelpDesk AI]`, body
  carrying the message plus sender, organization and reason). The
  visitor's own client sends it, so delivery is real and no credentials
  live in the project.
- Direct links (email, GitHub, LinkedIn) render **only** when their env
  vars are set, so the page never contains a dead link.

Option **B** was rejected: a local endpoint that cannot deliver anything
adds an attack surface (an unauthenticated public write path), storage
and abuse concerns, and buys no honesty the demo copy does not already
provide. Option **D** is the documented evolution: when a provider is
approved, the submit handler posts to a BFF endpoint and the copy
changes with it.

## Consequences

Positive:

- No fabricated delivery, no unhandled expectation from the visitor.
- No paid dependency, no credentials in the repository, no public write
  endpoint.
- The form still demonstrates real form engineering: validation,
  accessible errors, loading state, duplicate protection, reset.

Negative / accepted:

- A visitor must complete the handoff in their own email client; some
  will not. Direct links are offered alongside for exactly that reason.
- `mailto:` depends on a configured mail client on the visitor's device.
- The honest disclaimer is unusual copy for a landing page. That is the
  point: it is the product argument applied to the site itself.

## Follow-up

When real delivery is approved, add a BFF endpoint with rate limiting,
spam mitigation and server-side validation, switch the submit handler to
it, and update the success copy — the ADR that supersedes this one must
state which provider and why.
