import type { FieldDefinitionRepository } from '../../application/ports/field-definition.repository';
import type {
  FieldDefinition,
  FieldDefinitionStatus,
  FieldValidationObject,
  ProfileFieldType,
} from '../../domain/profile-fields';
import {
  Prisma,
  type OrganizationProfileField as FieldRow,
} from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaFieldDefinitionRepository implements FieldDefinitionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(definition: FieldDefinition): Promise<FieldDefinition | null> {
    // createMany with skipDuplicates is the atomic insert-or-detect the
    // branch repository established: two concurrent creates with the same
    // (organization, key) cannot both pass a pre-check and race on the
    // unique index. Count 0 means the key is taken.
    const inserted = await this.prisma.organizationProfileField.createMany({
      data: [
        {
          id: definition.id,
          organizationId: definition.organizationId,
          key: definition.key,
          labelEsAr: definition.labelEsAr,
          labelEnUs: definition.labelEnUs,
          type: definition.type,
          required: definition.required,
          editableByUser: definition.editableByUser,
          visibleToRequester: definition.visibleToRequester,
          visibleToStaff: definition.visibleToStaff,
          displayOrder: definition.displayOrder,
          validation: toJsonColumn(definition.validation),
          status: definition.status,
          createdAt: definition.createdAt,
          updatedAt: definition.updatedAt,
        },
      ],
      skipDuplicates: true,
    });
    return inserted.count === 1 ? definition : null;
  }

  async update(definition: FieldDefinition): Promise<void> {
    // key and type are deliberately absent from the UPDATE: the use case
    // already refused changing them, and not writing them makes the
    // immutability hold even against a future caller that forgets to.
    await this.prisma.organizationProfileField.update({
      where: { id: definition.id },
      data: {
        labelEsAr: definition.labelEsAr,
        labelEnUs: definition.labelEnUs,
        required: definition.required,
        editableByUser: definition.editableByUser,
        visibleToRequester: definition.visibleToRequester,
        visibleToStaff: definition.visibleToStaff,
        displayOrder: definition.displayOrder,
        validation: toJsonColumn(definition.validation),
        status: definition.status,
        updatedAt: definition.updatedAt,
      },
    });
  }

  async list(
    organizationId: string,
    includeArchived = false,
  ): Promise<FieldDefinition[]> {
    const rows = await this.prisma.organizationProfileField.findMany({
      where: {
        organizationId,
        ...(includeArchived ? {} : { status: 'active' }),
      },
      // key as tie-breaker so equal display orders stay stable.
      orderBy: [{ displayOrder: 'asc' }, { key: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<FieldDefinition | null> {
    // Scoped at the query so a foreign definition and a nonexistent one
    // produce the same null — confirming existence is the leak.
    const row = await this.prisma.organizationProfileField.findFirst({
      where: { id, organizationId },
    });
    return row ? toDomain(row) : null;
  }

  async findByKey(
    organizationId: string,
    key: string,
  ): Promise<FieldDefinition | null> {
    const row = await this.prisma.organizationProfileField.findUnique({
      where: { organizationId_key: { organizationId, key } },
    });
    return row ? toDomain(row) : null;
  }
}

/** Nullable Json columns need Prisma's DbNull sentinel, not JS null. */
function toJsonColumn(
  validation: FieldValidationObject | null,
): Prisma.InputJsonObject | typeof Prisma.DbNull {
  return validation === null
    ? Prisma.DbNull
    : (validation as Prisma.InputJsonObject);
}

function toDomain(row: FieldRow): FieldDefinition {
  return {
    id: row.id,
    organizationId: row.organizationId,
    key: row.key,
    labelEsAr: row.labelEsAr,
    labelEnUs: row.labelEnUs,
    // Stored values only ever come from the domain vocabulary; the closed
    // per-type schema validated `validation` before it was written.
    type: row.type as ProfileFieldType,
    required: row.required,
    editableByUser: row.editableByUser,
    visibleToRequester: row.visibleToRequester,
    visibleToStaff: row.visibleToStaff,
    displayOrder: row.displayOrder,
    validation: (row.validation as FieldValidationObject | null) ?? null,
    status: row.status as FieldDefinitionStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
