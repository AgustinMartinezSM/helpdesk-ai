import type { UserRepository } from '../ports/user.repository';

export interface IdentityOutput {
  id: string;
  email: string;
  roles: string[];
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

  async execute(userId: string): Promise<IdentityOutput | null> {
    const user = await this.users.findById(userId);
    if (!user) {
      return null;
    }
    return { id: user.id, email: user.email, roles: [...user.roles] };
  }
}
