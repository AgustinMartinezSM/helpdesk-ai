export abstract class AnalyticsDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ForbiddenAnalyticsActionError extends AnalyticsDomainError {
  constructor() {
    super('action not allowed for this actor');
  }
}
