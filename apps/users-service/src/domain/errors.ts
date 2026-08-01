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

// ---------------------------------------------------------------------------
// Organization-defined field errors (Sprint 9.6).
// ---------------------------------------------------------------------------

/**
 * One generic message on purpose: a field that belongs to another
 * organization, one that was archived and one that never existed all answer
 * alike, because confirming existence is the leak.
 */
export class FieldNotFoundError extends UserDomainError {
  constructor() {
    super('field not found');
  }
}

export class DuplicateFieldKeyError extends UserDomainError {
  constructor(key: string) {
    super(`this organization already has a field with key "${key}"`);
  }
}

/**
 * Raised when an update names a different key or type for an existing field.
 * The key is the stable reference values and events carry; the type defines
 * what the stored value strings MEAN — changing either would orphan every
 * value written under the old semantics, so both are immutable and the
 * answer is a conflict, not a validation error.
 */
export class ImmutableFieldKeyError extends UserDomainError {
  constructor(attribute: 'key' | 'type') {
    super(`a field's ${attribute} cannot change after creation`);
  }
}

/**
 * A definition that does not fit the model: bad key format, unknown type, or
 * a validation object outside its type's closed schema. 400-shaped — the
 * request itself is malformed, unlike the 409 conflicts above.
 */
export class InvalidFieldDefinitionError extends UserDomainError {
  constructor(reason: string) {
    super(`invalid field definition: ${reason}`);
  }
}

/** A value that fails the definition's declarative validation (422). */
export class InvalidFieldValueError extends UserDomainError {
  constructor(key: string, reason: string) {
    super(`invalid value for field "${key}": ${reason}`);
  }
}

/** Clearing a required field is refused at write time (D5) — 422. */
export class RequiredFieldValueError extends UserDomainError {
  constructor(key: string) {
    super(`field "${key}" is required and cannot be cleared`);
  }
}
