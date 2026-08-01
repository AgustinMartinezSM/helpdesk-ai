export const PROFILE_EVENT_PUBLISHER = Symbol('PROFILE_EVENT_PUBLISHER');

export interface ProfileUpdatedNotification {
  userId: string;
  /**
   * Person-level column names and/or organization field keys that ACTUALLY
   * changed — never values (D6: a value in an event would sit in the audit
   * trail's jsonb forever). Callers publish nothing when nothing changed.
   */
  changedKeys: string[];
  updatedAt: Date;
  /**
   * The acting context's tenant, when it has one (D6). A person-level edit
   * by the belongs-nowhere state is legitimate and publishes without it —
   * exactly the user.registered.v1 envelope shape.
   */
  organizationId?: string;
}

/**
 * Outbound profile events. Best-effort by contract: the write already
 * committed when this runs, so adapters log and swallow a broker failure
 * instead of failing the request (ADR 0006 — no outbox yet).
 */
export interface ProfileEventPublisher {
  profileUpdated(notification: ProfileUpdatedNotification): Promise<void>;
}
