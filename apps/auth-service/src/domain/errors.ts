/**
 * Domain errors carry messages safe to show to API clients. Anything
 * sensitive (which field failed, whether an email exists at login time)
 * must stay out of these messages.
 */
export abstract class AuthDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EmailAlreadyRegisteredError extends AuthDomainError {
  constructor() {
    super('An account with this email already exists');
  }
}

export class InvalidCredentialsError extends AuthDomainError {
  constructor() {
    // Deliberately identical for unknown email and wrong password:
    // login must not reveal which accounts exist.
    super('Invalid credentials');
  }
}

export class InvalidRefreshTokenError extends AuthDomainError {
  constructor() {
    super('Refresh token is invalid or expired');
  }
}

/**
 * A revoked refresh token was presented again. Either the legitimate client
 * replayed an old token or the token was stolen; all sessions of the user
 * are revoked as a precaution.
 */
export class RefreshTokenReuseError extends AuthDomainError {
  constructor() {
    super('Refresh token is invalid or expired');
  }
}

/**
 * Membership could not be determined while minting a token.
 *
 * Not the same as "this person belongs to no organization", which is a real
 * answer and mints a token with no tenant claims. This is the case where the
 * question could not be asked at all — organizations-service unreachable, a
 * rejected service credential, a response that did not parse.
 *
 * A token minted on that uncertainty would carry no tenant, and the write
 * paths now take the tenant from the token, so it would produce untenanted
 * rows that look exactly like rows belonging to nobody. Refusing is the only
 * honest answer, and it is deliberately a 503 rather than a 401: the caller's
 * credentials were fine, and telling them otherwise would send them to reset
 * a password that works.
 */
export class TenantContextUnavailableError extends AuthDomainError {
  constructor() {
    super('Sign-in is temporarily unavailable. Please try again.');
  }
}

/**
 * A token was requested for an organization the caller cannot act in
 * (Sprint 10.6, ADR 0025).
 *
 * Deliberately blind to WHICH kind of no it is. An organization the caller
 * does not belong to, one whose membership is suspended, one that is itself
 * suspended, and one that does not exist all answer alike — distinguishing
 * them would make the exchange an oracle for which organizations exist, which
 * is the cross-tenant leak ADR 0023 closed for names and slugs.
 *
 * A 404 rather than a 403, for the same reason every scoped not-found in the
 * platform is: confirming existence IS the leak. The caller is authenticated
 * and their session is fine, so it is not a credential failure either.
 */
export class OrganizationNotAvailableError extends AuthDomainError {
  constructor() {
    super('That organization is not available to this account');
  }
}
