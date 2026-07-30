import type { OrganizationRepository } from '../../application/ports/organization.repository';
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
