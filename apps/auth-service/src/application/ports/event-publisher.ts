export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface UserRegisteredEvent {
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
