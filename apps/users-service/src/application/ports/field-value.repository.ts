import type { FieldValue } from '../../domain/profile-fields';

export const FIELD_VALUE_REPOSITORY = Symbol('FIELD_VALUE_REPOSITORY');

/**
 * Values keyed by (field, user). Reads are organization-scoped through the
 * denormalized organizationId even though the field id alone would be
 * unambiguous — every caller is answering an org-first question and must not
 * depend on the definition join to know the tenant.
 */
export interface FieldValueRepository {
  find(fieldId: string, userId: string): Promise<FieldValue | null>;
  /** Insert or replace; the write was validated against the definition. */
  upsert(value: FieldValue): Promise<void>;
  /** Removes a value if present; false when there was nothing to clear. */
  delete(fieldId: string, userId: string): Promise<boolean>;
  listForUser(organizationId: string, userId: string): Promise<FieldValue[]>;
  /**
   * All values of the given users in one flat list — ONE query per page of
   * users, not one per user. Deliberately no fancier batching: directory
   * pages are small (pagination itself still "arrives with demand"), and a
   * flat IN-list query is the simplest thing that is not N+1.
   */
  listForUsers(
    organizationId: string,
    userIds: string[],
  ): Promise<FieldValue[]>;
}
