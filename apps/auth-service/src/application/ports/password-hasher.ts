export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** Never throws on malformed hashes; returns false instead. */
  verify(hash: string, plain: string): Promise<boolean>;
}
