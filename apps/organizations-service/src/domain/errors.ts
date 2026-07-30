export abstract class OrganizationDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Raised when the bootstrap organization is absent. It is created by the
 * initial migration, so this means the database was provisioned wrong rather
 * than that a request was wrong — the consumer lets it reject the message to
 * the DLQ instead of writing a membership pointing at nothing.
 */
export class OrganizationNotFoundError extends OrganizationDomainError {
  constructor(slug: string) {
    super(`organization "${slug}" not found`);
  }
}
