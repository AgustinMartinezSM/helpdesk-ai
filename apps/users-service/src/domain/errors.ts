export abstract class UserDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ProfileNotFoundError extends UserDomainError {
  constructor() {
    super('profile not found');
  }
}

export class ForbiddenProfileActionError extends UserDomainError {
  constructor() {
    super('action not allowed for this actor');
  }
}
