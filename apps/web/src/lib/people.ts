/**
 * Browser-side client for the BFF people endpoints — the directory from
 * users-service and invitations from organizations-service, both behind the
 * one /people prefix.
 *
 * Every call carries the in-memory access token. Refusals arrive with their
 * status intact and callers must distinguish them: a 403 means the person
 * lacks the permission (or lost it in the last few minutes, since the
 * session's permission list is a snapshot — ADR 0020), while a 404 on an
 * invitation deliberately means BOTH "no such row" and "not yours". Never
 * rewrite one into the other for a friendlier message; the ambiguity is the
 * server's security design, not an oversight.
 */

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? 'http://localhost:3001';

export interface DirectoryPerson {
  userId: string;
  email: string;
  displayName: string;
  preferredName: string | null;
  phone: string | null;
  registeredAt: string;
  /** Which template the membership carries. Display only. */
  roleTemplate?: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface Invitation {
  id: string;
  inviteeEmail: string;
  roleTemplate: string;
  status: InvitationStatus;
  /** Derived server-side at read time; only ever true while pending. */
  expired: boolean;
  invitedByUserId: string;
  expiresAt: string;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

/** The issue response, and the only place the code ever exists. */
export interface IssuedInvitation extends Invitation {
  code: string;
}

export interface InvitationPreview {
  organizationId: string;
  organizationName: string;
  roleTemplate: string;
  expiresAt: string;
}

export interface AcceptedInvitation {
  organizationId: string;
  roleTemplate: string;
  /** False when the person already belonged; their role was left alone. */
  membershipCreated: boolean;
}

export class PeopleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PeopleApiError';
  }
}

async function call<T>(
  accessToken: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = 'Something went wrong';
    try {
      const parsed = (await response.json()) as { message?: string | string[] };
      // Two shapes reach here: a validation pipe answers with string[], a
      // domain error filter with a string.
      message = Array.isArray(parsed.message)
        ? parsed.message.join(', ')
        : (parsed.message ?? message);
    } catch {
      // keep the generic message
    }
    throw new PeopleApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function listPeople(accessToken: string): Promise<DirectoryPerson[]> {
  return call(accessToken, 'GET', '/people');
}

export function listInvitations(
  accessToken: string,
  filter: { status?: InvitationStatus } = {},
): Promise<Invitation[]> {
  const query = filter.status ? `?status=${filter.status}` : '';
  return call(accessToken, 'GET', `/people/invitations${query}`);
}

/**
 * The response carries the one-time code. Callers must hold it in component
 * state and show it once — it is not stored anywhere and no endpoint can
 * return it again.
 */
export function issueInvitation(
  accessToken: string,
  input: { inviteeEmail: string; roleTemplate: string },
): Promise<IssuedInvitation> {
  return call(accessToken, 'POST', '/people/invitations', input);
}

export function revokeInvitation(
  accessToken: string,
  invitationId: string,
): Promise<Invitation> {
  return call(
    accessToken,
    'POST',
    `/people/invitations/${encodeURIComponent(invitationId)}/revoke`,
  );
}

/** Reads what a code would get you, without spending it. */
export function previewInvitation(
  accessToken: string,
  code: string,
): Promise<InvitationPreview> {
  return call(accessToken, 'POST', '/people/invitations/preview', { code });
}

/**
 * Spends the code. The caller's CURRENT token still carries no organization
 * afterwards — accepting does not re-mint it — so a successful accept must be
 * followed by a session refresh or the person appears to belong nowhere.
 */
export function acceptInvitation(
  accessToken: string,
  code: string,
): Promise<AcceptedInvitation> {
  return call(accessToken, 'POST', '/people/invitations/accept', { code });
}

/** Templates an admin may hand out. `owner` is refused server-side. */
export const INVITABLE_ROLE_TEMPLATES = [
  'organization_admin',
  'branch_manager',
  'service_desk_manager',
  'team_manager',
  'agent',
  'requester',
  'auditor',
] as const;

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  organization_admin: 'Administrator',
  branch_manager: 'Branch manager',
  service_desk_manager: 'Service desk manager',
  team_manager: 'Team manager',
  agent: 'Technician',
  requester: 'Employee',
  auditor: 'Auditor',
};

/**
 * The product's word for a template. The model's vocabulary and the
 * product's are deliberately allowed to differ (ADR 0016 says the UI should
 * say "cashier station 2", not "operational station"); an unknown key falls
 * back to itself rather than being hidden, so a template added server-side
 * shows up as something rather than vanishing.
 */
export function roleLabel(template: string | undefined): string {
  if (!template) {
    return 'Member';
  }
  return ROLE_LABELS[template] ?? template;
}
