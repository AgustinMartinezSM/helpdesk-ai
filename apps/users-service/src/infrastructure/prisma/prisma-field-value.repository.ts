import type { FieldValueRepository } from '../../application/ports/field-value.repository';
import type { FieldValue } from '../../domain/profile-fields';
import type { ProfileFieldValue as FieldValueRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaFieldValueRepository implements FieldValueRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(fieldId: string, userId: string): Promise<FieldValue | null> {
    const row = await this.prisma.profileFieldValue.findUnique({
      where: { fieldId_userId: { fieldId, userId } },
    });
    return row ? toDomain(row) : null;
  }

  async upsert(value: FieldValue): Promise<void> {
    await this.prisma.profileFieldValue.upsert({
      where: {
        fieldId_userId: { fieldId: value.fieldId, userId: value.userId },
      },
      create: {
        fieldId: value.fieldId,
        userId: value.userId,
        organizationId: value.organizationId,
        value: value.value,
        updatedAt: value.updatedAt,
      },
      update: { value: value.value, updatedAt: value.updatedAt },
    });
  }

  async delete(fieldId: string, userId: string): Promise<boolean> {
    // deleteMany rather than delete: clearing what is not there is a no-op
    // to report (false), not an error to catch.
    const deleted = await this.prisma.profileFieldValue.deleteMany({
      where: { fieldId, userId },
    });
    return deleted.count > 0;
  }

  async listForUser(
    organizationId: string,
    userId: string,
  ): Promise<FieldValue[]> {
    const rows = await this.prisma.profileFieldValue.findMany({
      where: { organizationId, userId },
    });
    return rows.map(toDomain);
  }

  async listForUsers(
    organizationId: string,
    userIds: string[],
  ): Promise<FieldValue[]> {
    // ONE IN-list query per page of users, not one per user. Deliberately
    // nothing fancier: directory pages are small at this scale, and the
    // (organization_id, user_id) index carries this read.
    const rows = await this.prisma.profileFieldValue.findMany({
      where: { organizationId, userId: { in: userIds } },
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: FieldValueRow): FieldValue {
  return {
    fieldId: row.fieldId,
    userId: row.userId,
    organizationId: row.organizationId,
    value: row.value,
    updatedAt: row.updatedAt,
  };
}
