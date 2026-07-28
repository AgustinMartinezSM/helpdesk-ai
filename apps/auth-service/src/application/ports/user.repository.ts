import type { User } from '../../domain/user';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  /**
   * Persists a new user. Must throw EmailAlreadyRegisteredError on a unique
   * email violation so concurrent registrations cannot race past the
   * use-case pre-check.
   */
  create(user: User): Promise<void>;
}
