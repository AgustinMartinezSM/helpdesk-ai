import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  FIELD_DEFINITION_STATUSES,
  PROFILE_FIELD_TYPES,
  type FieldDefinitionStatus,
  type ProfileFieldType,
} from '../../domain/profile-fields';

// ---------------------------------------------------------------------------
// Person-level profile edits. Tri-state PATCH, the update-branch pattern:
// absent leaves a column alone, null clears it, a value replaces it —
// @IsOptional skips the remaining validators for null as well as undefined.
// The whitelist IS the authorization boundary for what a person edit may
// touch: email is deliberately not here (a credential operation, ADR 0017),
// and the global pipe's forbidNonWhitelisted answers 400 for it.
// ---------------------------------------------------------------------------

export class UpdatePersonProfileDto {
  /**
   * No null: display_name stays NOT NULL because the UI renders it
   * everywhere, so it can change but never clear.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  displayName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  preferredName?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  phone?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  language?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  timezone?: string | null;
}

// ---------------------------------------------------------------------------
// Field values.
// ---------------------------------------------------------------------------

export class SetFieldValueDto {
  /**
   * Required but nullable: null MEANS clear, so unlike the PATCH DTOs the
   * property itself must be present — a PUT with no value says nothing.
   * Whether an empty-after-rules value is acceptable is the definition's
   * declarative validation to decide (422), not shape validation (400).
   */
  @ValidateIf((dto: SetFieldValueDto) => dto.value !== null)
  @IsString()
  @IsNotEmpty()
  value!: string | null;
}

// ---------------------------------------------------------------------------
// Field definitions. Same split as the membership DTOs: validation rejects
// words outside the vocabulary (400); the domain rejects states that are
// not reachable (409 duplicates, 409 immutable key/type). The `validation`
// object is only shape-checked here — the closed per-type schema lives in
// the domain and answers 400 through InvalidFieldDefinitionError.
// ---------------------------------------------------------------------------

export class CreateFieldDefinitionDto {
  /** Stable machine key; immutable after creation. */
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'key must start with a lowercase letter and use only lowercase letters, digits and underscores',
  })
  key!: string;

  @IsString()
  @IsNotEmpty()
  labelEsAr!: string;

  @IsString()
  @IsNotEmpty()
  labelEnUs!: string;

  @IsIn(PROFILE_FIELD_TYPES)
  type!: ProfileFieldType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  editableByUser?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleToRequester?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleToStaff?: boolean;

  @IsInt()
  displayOrder!: number;

  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown>;
}

export class UpdateFieldDefinitionDto {
  /**
   * key and type are accepted by the whitelist only so the domain can
   * refuse changing them with the 409 they deserve — a different key or
   * type conflicts with the row's immutable identity, it is not a
   * malformed request.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  key?: string;

  @IsOptional()
  @IsIn(PROFILE_FIELD_TYPES)
  type?: ProfileFieldType;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  labelEsAr?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  labelEnUs?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  editableByUser?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleToRequester?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleToStaff?: boolean;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  /** null clears the validation object; undefined leaves it alone. */
  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown> | null;

  /** Archiving is a status edit, reversible through this same field. */
  @IsOptional()
  @IsIn(FIELD_DEFINITION_STATUSES)
  status?: FieldDefinitionStatus;
}
