import { InvalidCredentialsError } from '../../domain/errors';
import { normalizeEmail } from '../../domain/user';
import type { PasswordHasher } from '../ports/password-hasher';
import type { UserRepository } from '../ports/user.repository';
import type { Session } from '../session.service';
import { SessionService } from '../session.service';

export interface LoginInput {
  email: string;
  password: string;
}

export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly sessions: SessionService,
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

    return this.sessions.issueSession(user);
  }
}
