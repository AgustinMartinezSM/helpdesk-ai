import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque invitation-code handling.
 *
 * Wire format handed to the admin: `<uuid>.<secret>` where secret is 32
 * random bytes, base64url. Storage keeps only sha256(secret); the id allows
 * an O(1) lookup without indexing on secret material.
 *
 * Deliberately the same shape as auth-service's refresh credential, down to
 * the split — the properties wanted here are the properties that design
 * already has, and two different codecs for the same problem would be two
 * places to get constant-time comparison wrong.
 *
 * Node's crypto built-ins are allowed in the application layer; framework
 * and database code are not.
 */

export interface ParsedInvitationCode {
  id: string;
  secret: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function generateInvitationSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function composeInvitationCode(id: string, secret: string): string {
  return `${id}.${secret}`;
}

export function parseInvitationCode(raw: string): ParsedInvitationCode | null {
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

export function hashInvitationSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time comparison of two hex-encoded hashes. */
export function invitationHashesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
