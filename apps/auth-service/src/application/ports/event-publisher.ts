export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/**
 * Request correlation carried alongside the event, never inside its
 * payload: it says which request caused the event, which is what lets an
 * audit row be joined back to it.
 */
export interface UserRegisteredEvent {
  readonly traceId?: string;
  userId: string;
  email: string;
  roles: string[];
  registeredAt: Date;
}

/**
 * Outbound domain events. Publishing is best-effort by contract: adapters
 * must never let a broker failure break the primary write that already
 * committed (there is no outbox yet — see ADR 0005).
 */
export interface EventPublisher {
  publishUserRegistered(event: UserRegisteredEvent): Promise<void>;
}
