import type { UserRepository } from '../ports/user.repository';

export interface IdentityOutput {
  id: string;
  email: string;
  roles: string[];
  /**
   * Echoed from the presented token's claims, not resolved again (ADR 0020).
   * /auth/me answers about the token you brought, so re-resolving would let
   * it describe a membership the token does not carry — and it would put a
   * second organizations-service round trip on an endpoint whose whole job is
   * to be cheap.
   */
  permissions: string[];
  organizationId: string | null;
}

/** The claims the caller's verified token carries, supplied by the controller. */
export interface PresentedClaims {
  permissions: string[];
  organizationId: string | null;
}

/**
 * The account behind a verified access token.
 *
 * Exists because phase 8 removed the `roles` claim from the token: /auth/me
 * still answers with the product's role names — apps/web renders them — so
 * they are read from the user row, the only place they live now, instead of
 * being echoed from claims.
 *
 * Null when the account no longer exists: a token can outlive its account by
 * up to one access-token TTL, and refusing then beats reconstructing an
 * identity from stale claims.
 */
export class GetIdentityUseCase {
  constructor(private readonly users: UserRepository) {}

  async execute(
    userId: string,
    claims: PresentedClaims,
  ): Promise<IdentityOutput | null> {
    const user = await this.users.findById(userId);
    if (!user) {
      return null;
    }
    return {
      id: user.id,
      email: user.email,
      roles: [...user.roles],
      permissions: [...claims.permissions],
      organizationId: claims.organizationId,
    };
  }
}
