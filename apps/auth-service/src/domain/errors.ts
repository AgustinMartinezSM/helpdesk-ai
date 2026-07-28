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
