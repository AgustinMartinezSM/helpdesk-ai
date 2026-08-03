/**
 * Browser-side client for the BFF session endpoints.
 *
 * The refresh token never reaches this code: it lives in an httpOnly cookie
 * managed by the BFF, sent automatically because every call here uses
 * credentials: 'include'. The short-lived access token is the only
 * credential the page holds, in memory only.
 */

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? 'http://localhost:3001';

export interface SessionUser {
  id: string;
  email: string;
  /**
   * Display data — the account page renders these. NOT an authorization
   * signal: nothing branches on them since ADR 0020 replaced the staff
   * boolean, and a role name has not decided access since the permission
   * migration.
   */
  roles: string[];
}

export interface BrowserSession {
  accessToken: string;
  expiresInSeconds: number;
  /**
   * What this person may do, echoed from the same membership resolution that
   * minted the token (ADR 0020). Use it to decide what to RENDER and nothing
   * else: every refusal is already enforced server-side, and this snapshot
   * goes stale with the token — up to JWT_ACCESS_TTL_SECONDS after a role
   * change, which is why a 403 must still render as a real message.
   *
   * Empty for an account that belongs to no organization yet. That is a
   * normal state, not an error, and it denies everything.
   */
  permissions: string[];
  organizationId: string | null;
  user: SessionUser;
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      return body.message.join(', ');
    }
    return body.message ?? 'Something went wrong';
  } catch {
    return 'Something went wrong';
  }
}

export async function loginRequest(
  email: string,
  password: string,
  sharedWorkstation = false,
): Promise<BrowserSession> {
  const response = await fetch(`${BFF_URL}/session/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    // The flag only ever SHORTENS the session server-side (ADR 0016's
    // shared-terminal increment), and it is omitted when false so the
    // normal login payload stays byte-identical.
    body: JSON.stringify({
      email,
      password,
      ...(sharedWorkstation ? { sharedWorkstation } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return (await response.json()) as BrowserSession;
}

/** Returns null when there is no recoverable session (no/expired cookie). */
export async function refreshRequest(): Promise<BrowserSession | null> {
  const response = await fetch(`${BFF_URL}/session/refresh`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as BrowserSession;
}

export async function logoutRequest(): Promise<void> {
  await fetch(`${BFF_URL}/session/logout`, {
    method: 'POST',
    credentials: 'include',
  });
}
