export abstract class AiDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Suggestions are a staff tool: drafts are written for a technician to
 * review, and every generation spends model budget. Requesters are refused
 * here, in the application layer, so the rule holds no matter which
 * transport reaches it.
 */
export class ForbiddenAiActionError extends AiDomainError {
  constructor() {
    super('AI suggestions are available to staff only');
  }
}

/**
 * The ticket does not exist, or the caller may not see it. One error for
 * both cases on purpose: tickets-service already refuses to confirm a
 * ticket's existence to non-owners (ADR 0011) and this service must not
 * become the side channel that does.
 */
export class TicketNotFoundError extends AiDomainError {
  constructor() {
    super('ticket not found');
  }
}

/**
 * tickets-service could not be reached, or refused the forwarded token for
 * a reason other than authorization (5xx, timeout, unreadable body). The
 * request fails: a suggestion built from partial context would be worse
 * than no suggestion.
 */
export class TicketSourceUnavailableError extends AiDomainError {
  constructor(detail: string) {
    super(`ticket content is temporarily unavailable (${detail})`);
  }
}

/**
 * The forwarded access token was rejected. Surfaced as 401 so the BFF's
 * existing refresh path handles it, instead of being reported as a server
 * fault.
 */
export class TicketAccessUnauthorizedError extends AiDomainError {
  constructor() {
    super('the access token was rejected while reading the ticket');
  }
}

/** The provider failed, timed out, or is misconfigured. */
export class ProviderUnavailableError extends AiDomainError {
  constructor(provider: string, detail: string) {
    super(`the ${provider} provider could not answer (${detail})`);
  }
}

/**
 * The provider answered, but not with something this domain recognizes
 * (ADR 0010). Nothing is stored. Distinct from ProviderUnavailableError
 * because the fix is different: one is an outage, the other is a model or
 * prompt problem, and conflating them hides both.
 */
export class ProviderOutputError extends AiDomainError {
  constructor(provider: string, task: string, detail: string) {
    super(`the ${provider} provider answered ${task} off-schema (${detail})`);
  }
}
