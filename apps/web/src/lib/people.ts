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

export type MembershipStatus =
  'active' | 'suspended' | 'deactivated' | 'invited';

export interface DirectoryPerson {
  userId: string;
  email: string;
  displayName: string;
  preferredName: string | null;
  phone: string | null;
  registeredAt: string;
  /** Which template the membership carries. Display only. */
  roleTemplate?: string;
  /** Present since the listing can be asked for non-active members. */
  status?: MembershipStatus;
}

export interface OrganizationBranch {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'archived';
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

/**
 * The directory. Without `status` the server answers ACTIVE members only —
 * the default every other caller depends on. A management screen asks for
 * 'all', because a suspended colleague who has vanished cannot be reinstated.
 */
export function listPeople(
  accessToken: string,
  status?: MembershipStatus | 'all',
): Promise<DirectoryPerson[]> {
  const query = status ? `?status=${status}` : '';
  return call(accessToken, 'GET', `/people${query}`);
}

/** Templates that may be assigned. Same list the invite form offers. */
export function changeMemberRole(
  accessToken: string,
  userId: string,
  roleTemplate: string,
): Promise<{ userId: string; roleTemplate: string; version: number }> {
  return call(
    accessToken,
    'PATCH',
    `/people/${encodeURIComponent(userId)}/role`,
    { roleTemplate },
  );
}

/**
 * Suspend, reinstate or remove. Removal is `deactivated` — the row stays, and
 * since Sprint 9.10 a removed person can be brought back.
 *
 * The change is NOT immediate for the person affected: their outstanding
 * access token keeps working until it expires (ADR 0014). Callers must not
 * describe this as cutting somebody off.
 */
export function changeMemberStatus(
  accessToken: string,
  userId: string,
  status: MembershipStatus,
): Promise<{ userId: string; status: MembershipStatus; version: number }> {
  return call(
    accessToken,
    'PATCH',
    `/people/${encodeURIComponent(userId)}/status`,
    { status },
  );
}

export function listBranches(
  accessToken: string,
): Promise<OrganizationBranch[]> {
  return call(accessToken, 'GET', '/people/branches');
}

export function listMemberBranches(
  accessToken: string,
  userId: string,
): Promise<{ userId: string; branchIds: string[] }> {
  return call(
    accessToken,
    'GET',
    `/people/${encodeURIComponent(userId)}/branches`,
  );
}

/** A replace, not a delta: anything absent from `branchIds` is removed. */
export function setMemberBranches(
  accessToken: string,
  userId: string,
  branchIds: string[],
): Promise<{ userId: string; branchIds: string[] }> {
  return call(
    accessToken,
    'PATCH',
    `/people/${encodeURIComponent(userId)}/branches`,
    { branchIds },
  );
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

/**
 * Templates an admin may hand out, whether by invitation or by changing an
 * existing membership. `owner` is absent because the server refuses it in
 * both directions: nobody can grant it, and nobody holding it can be
 * administered (ADR 0021).
 */
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
