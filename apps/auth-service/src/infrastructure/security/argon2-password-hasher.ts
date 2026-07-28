import * as argon2 from 'argon2';
import type { PasswordHasher } from '../../application/ports/password-hasher';

/**
 * argon2id parameters per the OWASP Password Storage Cheat Sheet baseline
 * for interactive logins (19 MiB memory, 2 iterations, 1 lane). Hashes are
 * PHC strings, so parameters can be raised later without breaking existing
 * hashes — verify() reads them from the hash itself.
 */
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // Malformed or foreign hash formats count as a failed verification,
      // never as a crash.
      return false;
    }
  }
}
