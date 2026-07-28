export const USER_ROLES = ['user', 'agent', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Account identity owned by auth-service. Profile data (name, preferences,
 * timezone, team membership) belongs to the future users-service and must
 * never live here.
 */
export interface User {
  readonly id: string;
  /** Always stored normalized: trimmed and lower-cased. */
  readonly email: string;
  /** PHC-format argon2id hash. The plain password never leaves a use case. */
  readonly passwordHash: string;
  readonly roles: UserRole[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
