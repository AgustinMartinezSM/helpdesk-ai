import type { Actor } from '@helpdesk-ai/security';
import { OWNER_ROLE_TEMPLATE, type Membership } from '../../domain/membership';
import {
  isReservedSlug,
  normalizeOrganizationName,
  slugFromName,
  type Organization,
} from '../../domain/organization';
import type { MembershipEventPublisher } from '../ports/event-publisher';
import type {
  Clock,
  IdGenerator,
  OrganizationRepository,
} from '../ports/organization.repository';

export interface CreateOrganizationInput {
  name: string;
  correlationId?: string;
}

export interface CreatedOrganization {
  organization: Organization;
  membership: Membership;
}

/**
 * Creates an organization and makes its creator the owner, in one write.
 *
 * This is the first path in the platform that inserts an Organization row
 * outside a migration, and the first that produces an `owner` membership at
 * all. Both deserve the reasoning rather than a comment saying they happen.
 *
 * WHY THIS IS NOT A BREACH OF ADR 0021. That decision record governs
 * ADMINISTERING an existing membership: the requested template must be
 * grantable by the actor, the target's current template must be too, `owner`
 * is refused in both directions, and nobody administers their own row. Every
 * one of those rules is about changing something that already exists. Here
 * there is nothing to change — the organization does not exist until this
 * call, and neither does the membership. An organization created without an
 * owner would be strictly worse: it would be the hole this closes, reopened
 * one row lower, and there would be no attributable way to fill it.
 *
 * `owner` is deliberately NOT routed through `canGrantRoleTemplate`. That
 * derivation exists to bound what one member may hand another, and it
 * excludes `owner` by constant precisely so no grant path can produce one.
 * This is not a grant path. Reusing the helper would have meant weakening it.
 *
 * ANYBODY AUTHENTICATED MAY CREATE ONE, INCLUDING SOMEBODY WHO ALREADY
 * BELONGS SOMEWHERE. Until Sprint 10.6 this refused a caller who held any
 * non-bootstrap membership, and the refusal was conditional by construction:
 * there was no selector, so `ResolveActiveMembershipUseCase` picked the oldest
 * non-bootstrap membership at every mint and a second organization would have
 * been one its own creator could never reach. ADR 0023 said in those words to
 * revisit it in the change that adds token exchange. That change is ADR 0025,
 * and the condition is gone: an organization is reachable now, so refusing to
 * create one would be a limit with nothing behind it.
 *
 * **What replaced the refusal is not nothing.** A created organization is
 * reachable only if something takes the creator there, and the default rule
 * would keep resolving to their OLDEST real membership — so the caller of this
 * use case is responsible for switching into what it just made. The web does
 * that by exchanging on the created id rather than plainly refreshing; a spec
 * pins it. Deleting the refusal without that would have reproduced the exact
 * stranded organization it existed to prevent, with nothing left to catch it.
 */
export class CreateOrganizationUseCase {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: MembershipEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    input: CreateOrganizationInput,
  ): Promise<CreatedOrganization> {
    const now = this.clock.now();
    // The same normaliser renaming uses (Sprint 10.5). It was a bare trim()
    // while this was the only path that wrote the column; a second writer is
    // what made "what a name IS" worth having one answer to.
    const name = normalizeOrganizationName(input.name);
    const organization: Organization = {
      id: this.ids.next(),
      slug: await this.availableSlug(name),
      name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const membership: Membership = {
      id: this.ids.next(),
      organizationId: organization.id,
      userId: actor.id,
      // One of only two places this template is ever written by application
      // code; the other is the transfer, which MOVES one rather than minting
      // one (ADR 0024). Neither is a grant path.
      roleTemplate: OWNER_ROLE_TEMPLATE,
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    // One transaction: an organization with no owner is unreachable, and an
    // owner membership pointing at nothing is a foreign-key violation. The
    // repository owns the boundary for the same reason invitation redemption
    // does (ADR 0006 — there is no outbox, so a split write is unrecoverable).
    const created = await this.organizations.createWithOwner(
      organization,
      membership,
    );

    // users-service projects `directory_memberships` from this event. Without
    // it the new owner would be absent from the People screen of the
    // organization they were just given authority over.
    await this.events.membershipCreated(
      created.membership,
      input.correlationId,
    );

    return created;
  }

  /**
   * A slug derived from the name, disambiguated until it is free.
   *
   * Collisions are resolved SILENTLY. Reporting one would answer "does an
   * organization by this name already exist?" to anybody holding an account,
   * across tenants — and the invitation preview is meant to be the only
   * public place an organization's name is exposed (Sprint 9.9).
   *
   * The loop is bounded and the fallback is a full random suffix rather than
   * an error: failing to create an organization because six names were taken
   * would be a worse outcome than an uglier slug, and the unique index is
   * still the thing that actually guarantees uniqueness at insert time.
   */
  private async availableSlug(name: string): Promise<string> {
    const base = slugFromName(name);

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${suffix()}`;
      if (isReservedSlug(candidate)) {
        continue;
      }
      if (!(await this.organizations.findBySlug(candidate))) {
        return candidate;
      }
    }

    return `${base}-${suffix()}${suffix()}`;
  }
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}
