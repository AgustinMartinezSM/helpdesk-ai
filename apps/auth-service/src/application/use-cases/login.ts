import { InvalidCredentialsError } from '../../domain/errors';
import { normalizeEmail } from '../../domain/user';
import type { PasswordHasher } from '../ports/password-hasher';
import type { UserRepository } from '../ports/user.repository';
import type { Session } from '../session.service';
import { SessionService } from '../session.service';

export interface LoginInput {
  email: string;
  password: string;
  /**
   * The client's declaration that this machine is shared (a store till, a
   * reception desk). It only SHRINKS the session — the refresh credential
   * lives hours instead of weeks — so it needs no trust: forging it costs
   * the forger session length, and omitting it changes nothing (ADR 0016's
   * shared-terminal increment).
   */
  sharedWorkstation?: boolean;
}

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionService,
    /** Refresh TTL for shared machines; capped at the normal TTL downstream. */
    private readonly sharedRefreshTtlSeconds: number,
  ) {}

  async execute(input: LoginInput): Promise<Session> {
    const user = await this.users.findByEmail(normalizeEmail(input.email));

    if (!user) {
      // Burn comparable CPU time to a real verification so response timing
      // does not reveal whether the email exists.
      await this.passwordHasher.hash(input.password);
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await this.passwordHasher.verify(
      user.passwordHash,
      input.password,
    );
    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }

    return this.sessions.issueSession(
      user,
      input.sharedWorkstation
        ? { refreshTtlSeconds: this.sharedRefreshTtlSeconds }
        : {},
    );
  }
}
