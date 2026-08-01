import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  BranchNotFoundError,
  ForbiddenTicketActionError,
} from '../../domain/errors';
import type {
  BranchRefRepository,
  StationRefRepository,
} from '../ports/structure-refs.repository';

/**
 * The create-ticket form's pickers (D6). Served from this service's own
 * projection because organizations-service stays off the gateway and keeps
 * no JWT — giving it a public face is a structural change that belongs to
 * the sprint that needs it.
 *
 * Both are gated on tickets.create: you need the picker to file a request.
 * The admin-facing branches.* permission keys arrive with the admin surface
 * in 9.8 — an unchecked key in a token is a claim nothing can falsify, so
 * they do not exist yet.
 */

export interface BranchPickerItem {
  id: string;
  code: string;
  name: string;
}

export interface StationPickerItem {
  id: string;
  code: string;
  name: string;
  area: string | null;
}

export class ListBranchesForPickerUseCase {
  constructor(private readonly branches: BranchRefRepository) {}

  async execute(actor: Actor): Promise<BranchPickerItem[]> {
    if (!hasPermission(actor, PERMISSIONS.TICKETS_CREATE)) {
      throw new ForbiddenTicketActionError();
    }
    const rows = await this.branches.listActive(requireOrganization(actor));
    // Projection internals (status, updatedAt) stay inside: the picker
    // shape is the response contract, and it only ever shows active rows.
    return rows.map(({ id, code, name }) => ({ id, code, name }));
  }
}

export class ListStationsForPickerUseCase {
  constructor(
    private readonly branches: BranchRefRepository,
    private readonly stations: StationRefRepository,
  ) {}

  async execute(actor: Actor, branchId: string): Promise<StationPickerItem[]> {
    if (!hasPermission(actor, PERMISSIONS.TICKETS_CREATE)) {
      throw new ForbiddenTicketActionError();
    }
    const organizationId = requireOrganization(actor);
    // 404 whether the branch is missing, archived or another tenant's: an
    // empty 200 would already say "this branch exists but has no stations",
    // so the not-found answer is the only one that hides existence.
    const branch = await this.branches.findActive(organizationId, branchId);
    if (!branch) {
      throw new BranchNotFoundError();
    }
    const rows = await this.stations.listActive(organizationId, branchId);
    return rows.map(({ id, code, name, area }) => ({ id, code, name, area }));
  }
}
