/**
 * The one place a secret is stripped out of text, and therefore the only
 * place that has to be right.
 *
 * Provider errors are the awkward case. A failed call produces a string that
 * came from outside this process — a transport error that may echo the
 * request it tried to send, an upstream body that may quote what it rejected,
 * a nested `cause` carrying the header bag. That string then travels a long
 * way: `AiDomainErrorFilter` returns it verbatim in the HTTP body, the logger
 * serializes it, and `message` is embedded in `stack`. Redacting at each of
 * those exits means every future exit has to remember. Redacting once, where
 * the error is constructed, means none of them do.
 *
 * Two layers, because either alone is insufficient:
 *
 * - **Exact value.** The configured key is replaced wherever it appears. This
 *   is the only layer that catches a credential with no recognizable shape,
 *   but it works only where the key is known.
 * - **Pattern.** Credential-shaped text is replaced whether or not it matches
 *   anything configured. This is what protects the paths that never see the
 *   key — an application layer re-wrapping an undici error, say — and it is
 *   what would catch a second provider's credential before anyone remembers
 *   to register it.
 *
 * The patterns keep the label and drop the value (`x-goog-api-key:
 * [redacted]`, not `[redacted]`) because a redacted message still has to
 * explain the failure. Redaction that destroys the diagnosis just moves the
 * outage from the log to the person reading it.
 */

const REDACTED = '[redacted]';

/** Beyond this, an "error detail" is a payload someone pasted into a log. */
const MAX_DETAIL_LENGTH = 500;

/** How far down a `cause` chain to walk before assuming a cycle. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Registered at bootstrap rather than injected, because the boundary is a
 * base-class constructor: domain errors are plain classes reachable from
 * anywhere, and threading a redactor into every `throw` is exactly the
 * discipline this module exists to remove. The pattern layer works with this
 * set empty, so a missed registration degrades coverage rather than
 * disabling redaction.
 */
const registeredSecrets = new Set<string>();

/** No-ops on an absent or empty value, so callers need no conditional. */
export function registerSecret(secret: string | undefined | null): void {
  if (typeof secret === 'string' && secret.length > 0) {
    registeredSecrets.add(secret);
  }
}

/** Test seam. Production registers once at startup and never clears. */
export function clearRegisteredSecrets(): void {
  registeredSecrets.clear();
}

interface RedactionRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const RULES: readonly RedactionRule[] = [
  // Google API keys and OAuth tokens are self-identifying: no ordinary
  // diagnostic sentence contains these prefixes followed by key material.
  { pattern: /AIza[0-9A-Za-z_-]{10,}/g, replacement: REDACTED },
  { pattern: /ya29\.[0-9A-Za-z_-]{10,}/g, replacement: REDACTED },

  // `Bearer <token>` anywhere, including inside a serialized header bag.
  // Runs before the named-carrier rule below so that an authorization value
  // is already tokenless if that rule stops at whitespace.
  {
    pattern: /\b(Bearer)\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi,
    replacement: `$1 ${REDACTED}`,
  },

  // Named credential carriers, in the three shapes they actually appear in:
  // `header: value`, `VAR=value`, and `"key":"value"` inside serialized JSON.
  // The value pattern deliberately allows spaces so that `authorization:
  // Bearer abc` is consumed whole — stopping at the space would redact the
  // scheme and leave the token.
  {
    pattern:
      /(["']?(?:x-goog-api-key|authorization|proxy-authorization|gemini_api_key|api[_-]?key)["']?\s*[:=]\s*)(["']?)([^"',;}\n]+)\2/gi,
    replacement: `$1$2${REDACTED}$2`,
  },

  // Credentials smuggled through a URL. This adapter never puts its key in a
  // query string, but a redirect or an upstream echo could.
  {
    pattern: /([?&](?:key|api_?key|access_token|token)=)([^&\s"']+)/gi,
    replacement: `$1${REDACTED}`,
  },
];

/**
 * Removes credentials from `text`. Safe to call more than once — replacing
 * an already-redacted string is a no-op.
 *
 * @param extraSecrets exact values known to the caller but not registered
 * globally, e.g. an adapter's own key.
 */
export function redactSecrets(
  text: string,
  extraSecrets: readonly string[] = [],
): string {
  let output = text;

  // Exact values first: a raw key may itself contain characters the pattern
  // rules would otherwise anchor on.
  for (const secret of [...registeredSecrets, ...extraSecrets]) {
    // An empty secret would splice the marker between every character.
    if (secret.length > 0 && output.includes(secret)) {
      output = output.split(secret).join(REDACTED);
    }
  }

  for (const { pattern, replacement } of RULES) {
    output = output.replace(pattern, replacement);
  }

  return output;
}

/**
 * Turns anything thrown by an external dependency into one short, redacted
 * line suitable for a domain error.
 *
 * Walks the `cause` chain, because that is where fetch implementations put
 * the interesting part — and, when a request is echoed, the header that
 * carried the credential. Stacks are deliberately excluded: they name this
 * project's file paths and add nothing a caller can act on.
 */
export function describeExternalError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current != null; depth += 1) {
    if (current instanceof Error) {
      if (current.message.length > 0) {
        parts.push(current.message);
      }
      current = current.cause;
      continue;
    }
    parts.push(describeValue(current));
    break;
  }

  const detail = parts.length > 0 ? parts.join(': ') : 'no detail';
  return redactSecrets(truncate(detail));
}

/** Serializes a non-Error throwable without letting a cycle or a getter throw. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  try {
    // A thrown object is usually a response or request bag, and its fields
    // are exactly what the pattern rules are written to find.
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserializable value]';
  }
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH
    ? `${text.slice(0, MAX_DETAIL_LENGTH)}…`
    : text;
}
