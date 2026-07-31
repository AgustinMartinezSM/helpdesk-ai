import type { BranchMembershipRepository } from '../../application/ports/structure.repository';
import type { BranchMembership } from '../../domain/branch';
import { PrismaService } from './prisma.service';

export class PrismaBranchMembershipRepository implements BranchMembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async assign(edge: BranchMembership): Promise<void> {
    // ON CONFLICT DO NOTHING: re-assigning is one edge, not an error, and
    // the existing edge keeps its original createdAt — when the cover
    // started must not move because an operator clicked twice.
    await this.prisma.branchMembership.createMany({
      data: [
        {
          membershipId: edge.membershipId,
          branchId: edge.branchId,
          createdAt: edge.createdAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  async remove(membershipId: string, branchId: string): Promise<void> {
    // deleteMany, not delete: removing an absent edge is a no-op, which is
    // what makes the DELETE verb idempotent.
    await this.prisma.branchMembership.deleteMany({
      where: { membershipId, branchId },
    });
  }

  async listBranchIds(membershipId: string): Promise<string[]> {
    // No status filter, on purpose: archived branches stay in the set (a
    // manager keeps seeing the history of a store that closed). Oldest
    // first so the `br` claim is deterministic across mints.
    const rows = await this.prisma.branchMembership.findMany({
      where: { membershipId },
      select: { branchId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.branchId);
  }
}
