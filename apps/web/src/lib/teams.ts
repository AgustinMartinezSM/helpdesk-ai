/**
 * Browser-side client for support teams — the groups that RESOLVE tickets
 * (ADR 0022), reached through the one /organization prefix like branches.
 *
 * A support team is not a department. A department is the requester's
 * organizational area and belongs to one branch; a team is organization-owned
 * and its branch reach is the explicit `branchIds` set below, where AN EMPTY
 * ARRAY MEANS ORGANIZATION-WIDE. Every function here that sends `branchIds`
 * sends the whole desired set, so an empty one is a real instruction rather
 * than a missing field.
 *
 * Refusals keep their status: a 404 on a team means both "no such team" and
 * "not yours", and a 403 means the permission is missing — possibly only for
 * the next few minutes, because the session's permission list is a snapshot
 * (ADR 0020).
 */
import { PeopleApiError } from './people';

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? 'http://localhost:3001';

export type SupportTeamStatus = 'active' | 'archived';

export interface SupportTeam {
  teamId: string;
  /** Stable operator-facing key, unique per organization, immutable. */
  code: string;
  name: string;
  status: SupportTeamStatus;
}

export interface SupportTeamDetail extends SupportTeam {
  /** User ids — the identifier the People screen shows, never a membership id. */
  memberUserIds: string[];
  /** EMPTY MEANS ORGANIZATION-WIDE, never "serves nothing". */
  branchIds: string[];
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

/** Every team of the organization, archived included: a screen that cannot
 * see an archived team cannot reopen it. Needs `teams.manage`. */
export function listTeams(accessToken: string): Promise<SupportTeam[]> {
  return call(accessToken, 'GET', '/organization/teams');
}

/**
 * The teams the signed-in person actually works in.
 *
 * Needs no permission at all, because it returns nothing their own token does
 * not already carry. This is what turns the `assignedTeamId` on a ticket into
 * a name for somebody who holds `tickets.read_team` and no team key — a team
 * manager, an agent, an auditor.
 */
export function listMyTeams(accessToken: string): Promise<SupportTeam[]> {
  return call(accessToken, 'GET', '/organization/teams/mine');
}

export function getTeam(
  accessToken: string,
  teamId: string,
): Promise<SupportTeamDetail> {
  return call(
    accessToken,
    'GET',
    `/organization/teams/${encodeURIComponent(teamId)}`,
  );
}

/** A new team starts organization-wide — no branch rows, so it serves every
 * branch until somebody narrows it. */
export function createTeam(
  accessToken: string,
  input: { code: string; name: string },
): Promise<SupportTeam> {
  return call(accessToken, 'POST', '/organization/teams', input);
}

/** The code is absent on purpose: it is the stable key, immutable once set. */
export function updateTeam(
  accessToken: string,
  teamId: string,
  changes: { name?: string; status?: SupportTeamStatus },
): Promise<SupportTeam> {
  return call(
    accessToken,
    'PATCH',
    `/organization/teams/${encodeURIComponent(teamId)}`,
    changes,
  );
}

/** Replaces the whole member set. Anything absent is removed. */
export function setTeamMembers(
  accessToken: string,
  teamId: string,
  userIds: string[],
): Promise<{ teamId: string; memberUserIds: string[] }> {
  return call(
    accessToken,
    'PATCH',
    `/organization/teams/${encodeURIComponent(teamId)}/members`,
    { userIds },
  );
}

/** Replaces the whole branch reach. An empty array makes the team
 * organization-wide, which is the difference between serving everywhere and
 * serving nowhere — the latter is not expressible, deliberately. */
export function setTeamScope(
  accessToken: string,
  teamId: string,
  branchIds: string[],
): Promise<{ teamId: string; branchIds: string[] }> {
  return call(
    accessToken,
    'PATCH',
    `/organization/teams/${encodeURIComponent(teamId)}/branches`,
    { branchIds },
  );
}

/**
 * What the product calls a support team, in one place.
 *
 * ADR 0016 made the same point about stations: the model's vocabulary and the
 * product's are allowed to differ, and the interface should use the words the
 * organization uses. "Support team" is deliberately not "team" on its own —
 * the screen also shows departments, and the two must not read as synonyms.
 */
export const TEAM_LABEL = 'Support team';

/** How a team's reach reads when nothing narrows it. */
export const ORGANIZATION_WIDE_LABEL = 'Serves the whole organization';
