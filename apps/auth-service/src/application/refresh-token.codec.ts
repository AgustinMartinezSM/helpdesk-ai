import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque refresh credential handling.
 *
 * Wire format handed to clients: `<uuid>.<secret>` where secret is 32 random
 * bytes, base64url. Storage keeps only sha256(secret); the id allows an O(1)
 * lookup without indexing on secret material.
 *
 * Node's crypto built-ins are allowed in the application layer; framework
 * and database code are not.
 */

export interface ParsedRefreshToken {
  id: string;
  secret: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function generateRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function composeRefreshToken(id: string, secret: string): string {
  return `${id}.${secret}`;
}

export function parseRefreshToken(raw: string): ParsedRefreshToken | null {
  const separator = raw.indexOf('.');
  if (separator <= 0 || separator === raw.length - 1) {
    return null;
  }
  const id = raw.slice(0, separator);
  const secret = raw.slice(separator + 1);
  if (!UUID_PATTERN.test(id)) {
    return null;
  }
  return { id, secret };
}

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time comparison of two hex-encoded hashes. */
export function refreshHashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
