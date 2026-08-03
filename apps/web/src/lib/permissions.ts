// The /permissions entry point, not the package root: the root exports
// JwtAccessGuard, which imports @nestjs/common and @nestjs/jwt. Importing it
// here would pull a server framework into the browser bundle to read a list
// of strings.
import {
  PERMISSIONS,
  type PermissionKey,
} from '@helpdesk-ai/security/permissions';
import type { BrowserSession } from './session';

export { PERMISSIONS, type PermissionKey };

/**
 * Whether to RENDER a control. Never whether to allow an action.
 *
 * ADR 0015 rule 2: permission checks are server-side, and the frontend may
 * hide. Everything this gates has a refusal in a use case behind it, so the
 * worst a wrong answer here can do is show a control that then fails — which
 * is exactly what happens for up to one access-token lifetime after somebody's
 * role changes, because the session's permission list is a snapshot (ADR
 * 0020). Pages must therefore render a 403 as a real message rather than
 * treating it as impossible.
 *
 * The keys come from @helpdesk-ai/security, the same module the services
 * import, so a renamed permission is a compile error on both sides instead of
 * a control that silently stops appearing.
 */
export function can(
  session: BrowserSession | null,
  permission: PermissionKey,
): boolean {
  return session?.permissions.includes(permission) ?? false;
}
