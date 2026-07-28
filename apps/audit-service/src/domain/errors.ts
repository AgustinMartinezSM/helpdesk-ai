export abstract class AuditDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenAuditActionError extends AuditDomainError {
  constructor() {
    super('action not allowed for this actor');
  }
}
