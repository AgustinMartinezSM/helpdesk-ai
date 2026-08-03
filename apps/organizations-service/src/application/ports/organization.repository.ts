import type { Membership } from '../../domain/membership';
import type { Organization } from '../../domain/organization';

export const ORGANIZATION_REPOSITORY = Symbol('ORGANIZATION_REPOSITORY');

export interface CreatedOrganizationRow {
  organization: Organization;
  membership: Membership;
}

export interface OrganizationRepository {
  findBySlug(slug: string): Promise<Organization | null>;
  findById(id: string): Promise<Organization | null>;
  /**
   * Inserts an organization and its first membership in ONE transaction.
   *
   * The two are inseparable by construction: an organization with no owner
   * cannot be administered by anybody, and a membership pointing at an
   * organization that did not commit is a foreign-key violation. There is no
   * outbox (ADR 0006), so a split write here would be unrecoverable in
   * exactly the way invitation redemption already refuses to be.
   */
  createWithOwner(
    organization: Organization,
    owner: Membership,
  ): Promise<CreatedOrganizationRow>;
}

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export const ID_GENERATOR = Symbol('ID_GENERATOR');

export interface IdGenerator {
  next(): string;
}
