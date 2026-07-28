import type { RefreshToken } from '../../domain/refresh-token';
import type { User } from '../../domain/user';
import type { Clock } from '../ports/clock';
import type {
  EventPublisher,
  UserRegisteredEvent,
} from '../ports/event-publisher';
import type { PasswordHasher } from '../ports/password-hasher';
import type { RefreshTokenRepository } from '../ports/refresh-token.repository';
import type {
  AccessTokenClaims,
  IssuedAccessToken,
  TokenIssuer,
} from '../ports/token-issuer';
import type { UserRepository } from '../ports/user.repository';
import { EmailAlreadyRegisteredError } from '../../domain/errors';

/** Deterministic in-memory test doubles for the application layer. */

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async create(user: User): Promise<void> {
    if (await this.findByEmail(user.email)) {
      throw new EmailAlreadyRegisteredError();
    }
    this.users.set(user.id, user);
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  readonly tokens = new Map<string, RefreshToken>();

  async findById(id: string): Promise<RefreshToken | null> {
    return this.tokens.get(id) ?? null;
  }

  async create(token: RefreshToken): Promise<void> {
    this.tokens.set(token.id, token);
  }

  async revoke(
    id: string,
    revokedAt: Date,
    replacedById?: string,
  ): Promise<void> {
    const existing = this.tokens.get(id);
    if (existing) {
      this.tokens.set(id, {
        ...existing,
        revokedAt,
        replacedById: replacedById ?? null,
      });
    }
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<void> {
    for (const [id, token] of this.tokens) {
      if (token.userId === userId && token.revokedAt === null) {
        this.tokens.set(id, { ...token, revokedAt });
      }
    }
  }

  activeTokensFor(userId: string): RefreshToken[] {
    return [...this.tokens.values()].filter(
      (token) => token.userId === userId && token.revokedAt === null,
    );
  }
}

export class FakePasswordHasher implements PasswordHasher {
  hashCalls = 0;

  async hash(plain: string): Promise<string> {
    this.hashCalls += 1;
    return `hashed:${plain}`;
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    return hash === `hashed:${plain}`;
  }
}

export class FakeEventPublisher implements EventPublisher {
  readonly published: UserRegisteredEvent[] = [];

  async publishUserRegistered(event: UserRegisteredEvent): Promise<void> {
    this.published.push(event);
  }
}

export class FakeTokenIssuer implements TokenIssuer {
  async issueAccessToken(
    claims: AccessTokenClaims,
  ): Promise<IssuedAccessToken> {
    return { token: `access:${claims.sub}`, expiresInSeconds: 900 };
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
