import type {
  CreatedOrganizationRow,
  OrganizationRepository,
} from '../../application/ports/organization.repository';
import type { Membership } from '../../domain/membership';
import type {
  Organization,
  OrganizationStatus,
} from '../../domain/organization';
import type { Organization as OrganizationRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findBySlug(slug: string): Promise<Organization | null> {
    const row = await this.prisma.organization.findUnique({ where: { slug } });
    return row ? toDomain(row) : null;
  }

  async findById(id: string): Promise<Organization | null> {
    const row = await this.prisma.organization.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async createWithOwner(
    organization: Organization,
    owner: Membership,
  ): Promise<CreatedOrganizationRow> {
    /**
     * Both rows or neither. `createIfAbsent` is deliberately NOT reused here:
     * its skipDuplicates semantics exist so a replayed registration leaves an
     * existing membership untouched, and silently doing nothing is the wrong
     * answer for a row that must exist for the organization to be usable. A
     * plain create inside the transaction lets the unique index refuse a
     * genuine duplicate loudly instead.
     */
    const [organizationRow, membershipRow] = await this.prisma.$transaction([
      this.prisma.organization.create({
        data: {
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
          status: organization.status,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
        },
      }),
      this.prisma.membership.create({
        data: {
          id: owner.id,
          organizationId: owner.organizationId,
          userId: owner.userId,
          roleTemplate: owner.roleTemplate,
          status: owner.status,
          version: owner.version,
          createdAt: owner.createdAt,
          updatedAt: owner.updatedAt,
        },
      }),
    ]);

    return {
      organization: toDomain(organizationRow),
      membership: {
        id: membershipRow.id,
        organizationId: membershipRow.organizationId,
        userId: membershipRow.userId,
        roleTemplate: membershipRow.roleTemplate as Membership['roleTemplate'],
        status: membershipRow.status as Membership['status'],
        version: membershipRow.version,
        createdAt: membershipRow.createdAt,
        updatedAt: membershipRow.updatedAt,
      },
    };
  }
}

function toDomain(row: OrganizationRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    // The column is a plain string so the vocabulary can grow without a
    // migration; anything unrecognized is treated as not active by the
    // domain, which fails closed.
    status: row.status as OrganizationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
