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

export function listTickets(
  accessToken: string,
  filter: { status?: TicketStatus } = {},
): Promise<TicketPage> {
  const query = filter.status ? `?status=${filter.status}` : '';
  return call(accessToken, 'GET', `/tickets${query}`);
}

export function getTicket(
  accessToken: string,
  id: string,
): Promise<TicketDetails> {
  return call(accessToken, 'GET', `/tickets/${encodeURIComponent(id)}`);
}

export function createTicket(
  accessToken: string,
  input: { title: string; description: string; priority?: TicketPriority },
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
