import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  DuplicateFieldKeyError,
  FieldNotFoundError,
  ForbiddenProfileActionError,
  ImmutableFieldKeyError,
  InvalidFieldDefinitionError,
} from '../../domain/errors';
import { parseFieldValidation } from '../../domain/field-validation';
import {
  FIELD_KEY_PATTERN,
  PROFILE_FIELD_TYPES,
  type FieldDefinition,
  type FieldDefinitionStatus,
  type ProfileFieldType,
} from '../../domain/profile-fields';
import type { FieldDefinitionRepository } from '../ports/field-definition.repository';
import type { Clock, IdGenerator } from '../ports/user-profile.repository';

/**
 * organization.update gates all three operations (D7): the field schema is
 * organization configuration, not people data — defining an employee-number
 * field is a config act even though its values describe people.
 */
function requireFieldManager(actor: Actor): string {
  if (!hasPermission(actor, PERMISSIONS.ORGANIZATION_UPDATE)) {
    throw new ForbiddenProfileActionError();
  }
  return requireOrganization(actor);
}

export interface CreateFieldDefinitionInput {
  key: string;
  labelEsAr: string;
  labelEnUs: string;
  type: string;
  required?: boolean;
  editableByUser?: boolean;
  visibleToRequester?: boolean;
  visibleToStaff?: boolean;
  displayOrder: number;
  validation?: unknown;
}

export class CreateFieldDefinitionUseCase {
  constructor(
    private readonly definitions: FieldDefinitionRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    actor: Actor,
    input: CreateFieldDefinitionInput,
  ): Promise<FieldDefinition> {
    const organizationId = requireFieldManager(actor);

    // The DTO already refuses these with a 400; this guards the use case
    // for callers that never went through HTTP validation.
    if (!FIELD_KEY_PATTERN.test(input.key)) {
      throw new InvalidFieldDefinitionError(
        `key "${input.key}" must match ${String(FIELD_KEY_PATTERN)}`,
      );
    }
    if (!(PROFILE_FIELD_TYPES as readonly string[]).includes(input.type)) {
      throw new InvalidFieldDefinitionError(
        `"${input.type}" is not a field type`,
      );
    }
    const type = input.type as ProfileFieldType;

    const now = this.clock.now();
    const definition: FieldDefinition = {
      id: this.ids.next(),
      organizationId,
      key: input.key,
      labelEsAr: input.labelEsAr,
      labelEnUs: input.labelEnUs,
      type,
      required: input.required ?? false,
      editableByUser: input.editableByUser ?? false,
      visibleToRequester: input.visibleToRequester ?? true,
      visibleToStaff: input.visibleToStaff ?? true,
      displayOrder: input.displayOrder,
      validation: parseFieldValidation(type, input.validation),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.definitions.create(definition);
    if (!created) {
      throw new DuplicateFieldKeyError(input.key);
    }
    return created;
  }
}

export interface UpdateFieldDefinitionInput {
  /**
   * key and type are accepted only to be refused: the whitelist pipe would
   * answer 400 for an unknown property, but sending a DIFFERENT key or type
   * is not a malformed request — it is a conflict with the row's immutable
   * identity, and it deserves the 409 that says so.
   */
  key?: string;
  type?: string;
  labelEsAr?: string;
  labelEnUs?: string;
  required?: boolean;
  editableByUser?: boolean;
  visibleToRequester?: boolean;
  visibleToStaff?: boolean;
  displayOrder?: number;
  /** null clears the validation object; undefined leaves it alone. */
  validation?: unknown;
  status?: FieldDefinitionStatus;
}

/**
 * Edits labels, flags, order, validation and status — never key or type.
 * Archiving IS a status update through this same operation: an archived
 * field leaves every view and refuses new values while its stored values
 * remain, and it can come back the same way (a field is a schema entry, not
 * an access grant — the update-branch reasoning).
 */
export class UpdateFieldDefinitionUseCase {
  constructor(
    private readonly definitions: FieldDefinitionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    fieldId: string,
    input: UpdateFieldDefinitionInput,
  ): Promise<FieldDefinition> {
    const organizationId = requireFieldManager(actor);

    const existing = await this.definitions.findById(organizationId, fieldId);
    if (!existing) {
      throw new FieldNotFoundError();
    }

    // Restating the current key or type is tolerated (an idempotent no-op);
    // naming a different one is the conflict.
    if (input.key !== undefined && input.key !== existing.key) {
      throw new ImmutableFieldKeyError('key');
    }
    if (input.type !== undefined && input.type !== existing.type) {
      throw new ImmutableFieldKeyError('type');
    }

    const updated: FieldDefinition = {
      ...existing,
      ...(input.labelEsAr !== undefined ? { labelEsAr: input.labelEsAr } : {}),
      ...(input.labelEnUs !== undefined ? { labelEnUs: input.labelEnUs } : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.editableByUser !== undefined
        ? { editableByUser: input.editableByUser }
        : {}),
      ...(input.visibleToRequester !== undefined
        ? { visibleToRequester: input.visibleToRequester }
        : {}),
      ...(input.visibleToStaff !== undefined
        ? { visibleToStaff: input.visibleToStaff }
        : {}),
      ...(input.displayOrder !== undefined
        ? { displayOrder: input.displayOrder }
        : {}),
      // Revalidated against the (unchangeable) type on every edit.
      validation:
        input.validation !== undefined
          ? parseFieldValidation(existing.type, input.validation)
          : existing.validation,
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: this.clock.now(),
    };

    await this.definitions.update(updated);
    return updated;
  }
}

export class ListFieldDefinitionsUseCase {
  constructor(private readonly definitions: FieldDefinitionRepository) {}

  async execute(
    actor: Actor,
    includeArchived = false,
  ): Promise<FieldDefinition[]> {
    const organizationId = requireFieldManager(actor);
    return this.definitions.list(organizationId, includeArchived);
  }
}
