/**
 * Browser-side client for the BFF tickets endpoints. Every call carries the
 * in-memory access token; a 401 signals the caller to refresh or re-login.
 */

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? 'http://localhost:3001';

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string | null;
  requesterId: string;
  assigneeId: string | null;
  /** Where the request was filed. Null forever is legitimate (ADR 0016). */
  branchId: string | null;
  /**
   * The SUPPORT TEAM that owns resolving this, never the requester's
   * department (ADR 0022). Null means nobody has routed it yet, which is an
   * ordinary state and not a gap.
   */
  assignedTeamId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketComment {
  id: string;
  authorId: string;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface TicketHistoryEntry {
  action: string;
  detail: string | null;
  createdAt: string;
}

export interface TicketDetails {
  ticket: Ticket;
  comments: TicketComment[];
  history: TicketHistoryEntry[];
}

export interface TicketPage {
  items: Ticket[];
  total: number;
}

export class TicketsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'TicketsApiError';
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
      message = Array.isArray(parsed.message)
        ? parsed.message.join(', ')
        : (parsed.message ?? message);
    } catch {
      // keep the generic message
    }
    throw new TicketsApiError(message, response.status);
  }

  return (await response.json()) as T;
}

/**
 * The listing, already scoped by the server to whatever the caller may see.
 *
 * `assignedTeamId` narrows to one support team. For a `tickets.read_team`
 * holder the server intersects it with their own team set and answers the
 * empty page for anything outside it — never an error, because a 4xx would
 * confirm the team exists.
 */
export function listTickets(
  accessToken: string,
  filter: { status?: TicketStatus; assignedTeamId?: string } = {},
): Promise<TicketPage> {
  const query = new URLSearchParams();
  if (filter.status) query.set('status', filter.status);
  if (filter.assignedTeamId) query.set('assignedTeamId', filter.assignedTeamId);
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return call(accessToken, 'GET', `/tickets${suffix}`);
}

export function getTicket(
  accessToken: string,
  id: string,
): Promise<TicketDetails> {
  return call(accessToken, 'GET', `/tickets/${encodeURIComponent(id)}`);
}

export interface BranchOption {
  id: string;
  code: string;
  name: string;
}

export interface StationOption {
  id: string;
  code: string;
  name: string;
  area: string | null;
}

/** Active branches of the caller's organization; empty for the shop that
 * never configured any — the form then renders exactly as before. */
export function listBranches(accessToken: string): Promise<BranchOption[]> {
  return call(accessToken, 'GET', '/tickets/branches');
}

export function listStations(
  accessToken: string,
  branchId: string,
): Promise<StationOption[]> {
  return call(
    accessToken,
    'GET',
    `/tickets/branches/${encodeURIComponent(branchId)}/stations`,
  );
}

export function createTicket(
  accessToken: string,
  input: {
    title: string;
    description: string;
    priority?: TicketPriority;
    branchId?: string;
    stationId?: string;
  },
): Promise<Ticket> {
  return call(accessToken, 'POST', '/tickets', input);
}

export function addComment(
  accessToken: string,
  id: string,
  body: string,
): Promise<TicketComment> {
  return call(
    accessToken,
    'POST',
    `/tickets/${encodeURIComponent(id)}/comments`,
    {
      body,
    },
  );
}

/**
 * Sends the ticket to the support team that should resolve it, or takes it
 * back with null.
 *
 * This changes WHO CAN SEE the ticket, which is why it needs `routing.manage`
 * rather than being an ordinary field edit. The server answers one generic
 * 422 for every reason a team cannot take it — archived, another tenant's,
 * out of branch scope, or a ticket with no branch at all sent to a scoped
 * team — and the caller should render that message rather than guess which.
 */
export function routeTicket(
  accessToken: string,
  id: string,
  teamId: string | null,
): Promise<Ticket> {
  return call(accessToken, 'PATCH', `/tickets/${encodeURIComponent(id)}/team`, {
    teamId,
  });
}

export function changeStatus(
  accessToken: string,
  id: string,
  status: TicketStatus,
): Promise<Ticket> {
  return call(
    accessToken,
    'PATCH',
    `/tickets/${encodeURIComponent(id)}/status`,
    {
      status,
    },
  );
}
