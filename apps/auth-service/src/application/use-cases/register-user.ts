import { randomUUID } from 'node:crypto';
import { EmailAlreadyRegisteredError } from '../../domain/errors';
import { normalizeEmail, type User } from '../../domain/user';
import type { Clock } from '../ports/clock';
import type { EventPublisher } from '../ports/event-publisher';
import type { PasswordHasher } from '../ports/password-hasher';
import type { UserRepository } from '../ports/user.repository';

export interface RegisterUserInput {
  email: string;
  password: string;
}

export interface RegisterUserOutput {
  id: string;
  email: string;
  roles: string[];
}

export class RegisterUserUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  async execute(
    input: RegisterUserInput,
    traceId?: string,
  ): Promise<RegisterUserOutput> {
    const email = normalizeEmail(input.email);

    // Fast path; the repository still enforces uniqueness transactionally,
    // so a concurrent duplicate registration cannot slip through.
    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredError();
    }

    const now = this.clock.now();
    const user: User = {
      id: randomUUID(),
      email,
      passwordHash: await this.passwordHasher.hash(input.password),
      roles: ['user'],
      createdAt: now,
      updatedAt: now,
    };

    await this.users.create(user);

    await this.events.publishUserRegistered({
      userId: user.id,
      email: user.email,
      roles: [...user.roles],
      registeredAt: now,
      traceId,
    });

    return { id: user.id, email: user.email, roles: [...user.roles] };
  }
}
