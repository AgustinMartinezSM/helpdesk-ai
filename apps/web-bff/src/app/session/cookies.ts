/**
 * Minimal request-cookie reader. The BFF only ever reads its own refresh
 * cookie, so a full cookie-parsing dependency buys nothing; response-side
 * cookies use Express's built-in res.cookie / res.clearCookie.
 */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() === name) {
      const raw = pair.slice(separator + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}
