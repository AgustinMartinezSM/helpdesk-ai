import type { RefreshToken } from '../../domain/refresh-token';
import type { User } from '../../domain/user';
import type { Clock } from '../ports/clock';
import type {
  EventPublisher,
  UserRegisteredEvent,
} from '../ports/event-publisher';
import type {
  MembershipResolver,
  ResolvedMembership,
  SessionLogger,
} from '../ports/membership-resolver';
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
  /** Every claim set handed to the issuer, so specs can assert on them. */
  readonly issued: AccessTokenClaims[] = [];

  async issueAccessToken(
    claims: AccessTokenClaims,
  ): Promise<IssuedAccessToken> {
    this.issued.push(claims);
    return { token: `access:${claims.sub}`, expiresInSeconds: 900 };
  }

  get lastClaims(): AccessTokenClaims | undefined {
    return this.issued.at(-1);
  }
}

export class FakeMembershipResolver implements MembershipResolver {
  calls: string[] = [];
  /**
   * What each call ASKED for, alongside `calls`. Kept separate rather than
   * changing `calls`'s shape so the existing assertions about who was resolved
   * keep meaning what they meant.
   */
  requested: (string | undefined)[] = [];

  constructor(
    private readonly outcome:
      | { kind: 'resolved'; membership: ResolvedMembership }
      | { kind: 'none' }
      | { kind: 'fails'; error: Error },
    /**
     * Memberships this fake will honour when asked for BY ID (Sprint 10.6).
     * Anything else answers null, which is how the real resolver reports an
     * organization the person cannot act in — so a use case that stopped
     * checking would fail here rather than pass against a doll that hands out
     * whatever it is asked for.
     */
    private readonly byOrganization: ReadonlyMap<
      string,
      ResolvedMembership
    > = new Map(),
  ) {}

  static resolving(membership: ResolvedMembership): FakeMembershipResolver {
    return new FakeMembershipResolver({ kind: 'resolved', membership });
  }

  /**
   * A default answer plus the organizations that may be asked for by id.
   * Anything not listed is refused, exactly as the real one refuses.
   */
  static withOrganizations(
    fallback: ResolvedMembership | null,
    ...selectable: ResolvedMembership[]
  ): FakeMembershipResolver {
    return new FakeMembershipResolver(
      fallback ? { kind: 'resolved', membership: fallback } : { kind: 'none' },
      new Map(selectable.map((entry) => [entry.organizationId, entry])),
    );
  }

  static resolvingNothing(): FakeMembershipResolver {
    return new FakeMembershipResolver({ kind: 'none' });
  }

  static failing(
    message = 'organizations-service is down',
  ): FakeMembershipResolver {
    return new FakeMembershipResolver({
      kind: 'fails',
      error: new Error(message),
    });
  }

  async resolveFor(
    userId: string,
    organizationId?: string,
  ): Promise<ResolvedMembership | null> {
    this.calls.push(userId);
    this.requested.push(organizationId);
    if (this.outcome.kind === 'fails') {
      throw this.outcome.error;
    }
    if (organizationId) {
      return this.byOrganization.get(organizationId) ?? null;
    }
    return this.outcome.kind === 'resolved' ? this.outcome.membership : null;
  }
}

export class RecordingLogger implements SessionLogger {
  readonly warnings: string[] = [];
  readonly errors: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
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
