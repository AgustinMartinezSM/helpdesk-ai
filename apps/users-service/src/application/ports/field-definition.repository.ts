import type { FieldDefinition } from '../../domain/profile-fields';

export const FIELD_DEFINITION_REPOSITORY = Symbol(
  'FIELD_DEFINITION_REPOSITORY',
);

/**
 * Definitions are organization-owned rows: every read is scoped by the
 * tenant from the token, so a foreign definition and a nonexistent one
 * produce the same null.
 */
export interface FieldDefinitionRepository {
  /**
   * Atomic insert-or-detect on the (organization, key) unique index — the
   * branch-repository pattern: null means the key is taken and the caller
   * turns that into the domain's duplicate error; a pre-check could not
   * survive two concurrent creates.
   */
  create(definition: FieldDefinition): Promise<FieldDefinition | null>;
  /**
   * Persists the post-change row. key and type are immutable by
   * construction: the use case builds `definition` from a scoped read and
   * refuses changes to either before calling this, and the adapter never
   * writes them.
   */
  update(definition: FieldDefinition): Promise<void>;
  /**
   * Definitions ordered by display order. Active only by default: archived
   * fields leave every member-facing view; the management surface may ask
   * for them explicitly.
   */
  list(
    organizationId: string,
    includeArchived?: boolean,
  ): Promise<FieldDefinition[]>;
  findById(organizationId: string, id: string): Promise<FieldDefinition | null>;
  findByKey(
    organizationId: string,
    key: string,
  ): Promise<FieldDefinition | null>;
}
