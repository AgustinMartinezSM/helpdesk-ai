/**
 * Organization-defined profile fields (Sprint 9.6, D2/D3). Definitions and
 * values are directory data owned by this service (ADR 0018): none of these
 * rows decides access, which is why they live here and not in the
 * authorization substrate. ADR 0017's boundary holds throughout — no field
 * defined here can ever become a login identifier.
 */

/** The closed type vocabulary of §14's field model. */
export const PROFILE_FIELD_TYPES = [
  'text',
  'number',
  'select',
  'boolean',
  'date',
  'phone',
] as const;

export type ProfileFieldType = (typeof PROFILE_FIELD_TYPES)[number];

export const FIELD_DEFINITION_STATUSES = ['active', 'archived'] as const;

export type FieldDefinitionStatus = (typeof FIELD_DEFINITION_STATUSES)[number];

/**
 * Stable machine key: immutable after creation because values, events and
 * (eventually) CSV imports reference fields by key, and a renamed key would
 * silently orphan all of them.
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * The declarative validation object as stored: a plain JSON object whose
 * shape was checked against the closed per-type schema at definition-write
 * time (see field-validation.ts). Data, never code.
 */
export type FieldValidationObject = Readonly<Record<string, unknown>>;

export interface FieldDefinition {
  readonly id: string;
  /** Identifier issued by organizations-service; opaque, never an FK (ADR 0003). */
  readonly organizationId: string;
  readonly key: string;
  /** Both locale labels stored now so i18n in 10.8 is content, not schema churn. */
  readonly labelEsAr: string;
  readonly labelEnUs: string;
  readonly type: ProfileFieldType;
  readonly required: boolean;
  readonly editableByUser: boolean;
  readonly visibleToRequester: boolean;
  readonly visibleToStaff: boolean;
  readonly displayOrder: number;
  readonly validation: FieldValidationObject | null;
  readonly status: FieldDefinitionStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * One value per (field, user), stored as the type's canonical text
 * representation (see field-validation.ts). organizationId is denormalized
 * from the definition so every org-first read answers without a join.
 */
export interface FieldValue {
  readonly fieldId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly value: string;
  readonly updatedAt: Date;
}
