import type { Invitation, InvitationStatus } from '../../domain/invitation';
import type { Membership } from '../../domain/membership';

export const INVITATION_REPOSITORY = Symbol('INVITATION_REPOSITORY');

export interface InvitationListFilter {
  organizationId: string;
  status?: InvitationStatus;
  limit: number;
  offset: number;
}

export interface RedeemInvitationInput {
  invitationId: string;
  acceptedByUserId: string;
  at: Date;
  /**
   * The membership to create if the person does not already have one. Built
   * by the use case so the adapter stays free of id generation and clocks.
   */
  membership: Membership;
}

export interface RedeemInvitationResult {
  invitation: Invitation;
  membership: Membership;
  /** True exactly when THIS redemption inserted the membership row. */
  membershipCreated: boolean;
}

export interface InvitationRepository {
  /**
   * Insert a pending invitation. Throws DuplicatePendingInvitationError when
   * the organization already has one pending for the address — the partial
   * unique index is what decides, not a prior read, so two concurrent issues
   * cannot both succeed.
   */
  create(invitation: Invitation): Promise<Invitation>;
  /**
   * Lookup by id alone, deliberately unscoped by organization: redemption
   * happens before the redeemer belongs anywhere, so there is no tenant to
   * scope by. The code's secret is what authorizes the read, and the use case
   * compares its hash before doing anything with the row.
   */
  findById(invitationId: string): Promise<Invitation | null>;
  /** Scoped lookup for the issuing side, where a tenant does exist. */
  findByOrganizationAndId(
    organizationId: string,
    invitationId: string,
  ): Promise<Invitation | null>;
  list(filter: InvitationListFilter): Promise<Invitation[]>;
  /**
   * What this organization already knows about a batch of addresses, in one
   * query (Sprint 9.15).
   *
   * `pending` means a live code is already out there and `accepted` means they
   * came in through one — which is how a CSV import stays idempotent without a
   * new mechanism: both are skips, so re-running a file converges. Addresses
   * with no invitation are simply absent from the map.
   *
   * It answers from rows THIS service owns. An address that became a member
   * without an invitation — the first administrator, made in SQL, or a legacy
   * backfilled user — is not in the map, so an import would issue them a code;
   * redeeming it is harmless, because the membership insert skips duplicates
   * and leaves their existing role alone.
   */
  findStatusesByEmails(
    organizationId: string,
    emails: readonly string[],
  ): Promise<Map<string, 'pending' | 'accepted'>>;
  /**
   * Consume the invitation and create the membership in ONE transaction.
   *
   * This is the whole reason invitations live in this service (ADR 0019):
   * with no outbox and no consumer retry, a redemption split across two
   * writes can leave a burned code with no membership, and the code cannot be
   * reissued because its secret is not derivable from anything.
   *
   * The consuming UPDATE is conditional on the row still being pending, so
   * two concurrent redemptions of the same code produce exactly one
   * membership. Returns null when this call lost that race — the caller turns
   * that into the same generic refusal every other non-redeemable reason
   * gets.
   *
   * `membershipCreated` is false when the person already belonged: the
   * invitation is still consumed, no row is touched, and no membership event
   * is published for a membership that did not appear.
   */
  redeem(input: RedeemInvitationInput): Promise<RedeemInvitationResult | null>;
  /**
   * Revoke, conditional on the row still being pending and belonging to the
   * organization. Returns null when either is false, which the caller turns
   * into a refusal rather than a silent success.
   */
  revoke(
    organizationId: string,
    invitationId: string,
    revokedAt: Date,
  ): Promise<Invitation | null>;
}
