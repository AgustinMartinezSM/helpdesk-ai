# Sprint 10.4 — An organization can be created from the product

Status: **OPEN (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 10.3 is merged and closed with remote
CI green: run `30855665981` on `19760f2`, plus its closing record on
`aa23e51`. `main` equals `origin/main` at `aa23e51`, working tree clean. The
last sprint document is `SPRINT-010.3.md`.

**This is the first domain sprint of Block B.** 10.0 through 10.3 were
strategy, tokens, identity and copy. This one changes what the platform can
do, so the invariants below are the readiness work rather than a preamble to
it.

### The gap, stated exactly

`docs/architecture/pilot-readiness.md` lists it twice and the handoff three
times: **the first administrator of a fresh database has to be made in SQL.**
That is not an oversight — Sprint 9.10 deleted the operator endpoint that used
to promote somebody, because it was an unattributable write path (ADR 0016),
and deleting it was the intended consequence. But it leaves a real hole: a
person can register, and then there is nothing they can do.

Registration lands everyone in the bootstrap organization — the migration's
holding pen — on the `requester` template. From there the only way into a real
organization is an invitation somebody else issued, which requires an
organization that somebody already made by hand.

### The mechanism that decides the scope

`ResolveActiveMembershipUseCase` walks memberships oldest-first and **returns
the first non-bootstrap organization**, falling back to the bootstrap one.
There is no organization selector and no token exchange (ADR 0014 defers
both).

That has a precise consequence, and it is the whole reason this sprint is
narrow:

- Somebody whose only membership is the bootstrap one creates an
  organization → the new membership is the first real one → **the next token
  mint lands them in it.** It works, by exactly the mechanism Sprint 9.8 added
  to make invitations work.
- Somebody who already belongs to a real organization creates a second one →
  the **older** real membership still wins → they would never land in the new
  organization, and nothing in the product could take them there.

So: **only somebody who does not yet belong to a real organization may create
one.** That is not a simplification, it is the honest boundary of what the
platform can currently express, and the refusal says so rather than pretending
the feature is coming.

### The invariants this stresses, and why each survives

**`owner` can be neither granted nor targeted (ADR 0021).** The creator
becomes the organization's `owner`, which is the first owner membership
created outside a migration. This does not breach the rule: ADR 0021 governs
_administering an existing membership_ — a grant to somebody else, or a change
to your own. Creation is a single atomic act with an attributable actor, and
an organization created without an owner would be strictly worse — it would be
the very hole this sprint exists to close, reopened one row lower.

**Nobody administers their own membership (ADR 0021).** Unchanged. The
creator's membership is created, never subsequently changed by them; every
later change still goes through the four rules, and they will still be unable
to alter their own.

**No unattributable write path (ADR 0016).** The route is authenticated. The
creator comes from the verified token, never from a body field — the same
shape `accept-invitation` uses for the addressee, and for the same reason.

**A slug collision must not be reported.** Sprint 9.9 established that the
invitation preview is the only public place an organization's name is exposed.
Answering "that name is taken" would turn organization creation into an
enumeration oracle across tenants. So the slug is **derived and disambiguated
silently**, never chosen by the caller and never refused for being taken.

**`bootstrap` is reserved.** It is a constant that anchors recovery
(`domain/organization.ts` says so), and a user-supplied name must not be able
to produce it.

### The precedent this follows

`accept-invitation.ts` is the closest existing shape and this sprint copies
it deliberately: a route on this service that is **tenantless on purpose** —
the caller does not belong yet — with **no permission key**, because being the
authenticated caller is the authorization. Its comment already generalises the
pattern from `PATCH /users/me`: "being yourself is enough".

## What this sprint is, and is not

**In scope:** creating an organization from the product, the creator becoming
its owner, the refusals above, the events the existing contracts already
carry, a screen for somebody who belongs nowhere, an ADR for the decision, and
tests at the unit, controller and integration levels.

**Out of scope, and deliberately:** an organization selector or token exchange
(ADR 0014 defers them, and this sprint's boundary exists _because_ they are
deferred); transfer of ownership; renaming an organization; changing a slug;
deleting or suspending one from the product; email; and every Block A item.
**No new event contract** unless a consumer needs one — no consumer, no
promise (ADR 0022).

## Definition of Done

- A person who has just registered can create an organization and, at their
  next session refresh, be acting inside it as its owner.
- A person who already belongs to a real organization is refused, in a message
  that says why rather than implying a bug.
- The slug is derived, unique, never caller-supplied, never reported as taken,
  and can never be `bootstrap`.
- Nothing about ADR 0021's four rules changes, and a test says so.
- The refusal paths are covered at the HTTP boundary, not only below it —
  the lesson Sprint 9.13 paid for.
- `product-status.ts` moves only if the capability genuinely moved, and ADR
  0009's status vocabulary decides which way.
- The full gate passes plus the organizations integration suite, commits are
  focused Conventional Commits, merge to `main` is `--ff-only`, remote CI
  green on the final HEAD, working tree clean, and `CURRENT-HANDOFF.md` names
  the next exact action.
