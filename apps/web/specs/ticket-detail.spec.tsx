import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import TicketDetailPage from '../src/app/(app)/tickets/[id]/page';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: 't1' }),
}));

const USER_SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: 'org-1',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

// The gate is the permission, not the role name (ADR 0020). These two keys
// are exactly what the ticket detail page checks, and what the API checks.
const AGENT_SESSION = {
  ...USER_SESSION,
  permissions: ['tickets.change_status', 'tickets.note_internal'],
  user: { id: 'staff1', email: 's@b.com', roles: ['agent'] },
};

function makeDetails(overrides: Record<string, unknown> = {}) {
  return {
    ticket: {
      id: 't1',
      title: 'Broken printer',
      description: 'It shows a paper jam that is not there.',
      status: 'open',
      priority: 'high',
      category: null,
      requesterId: 'u1',
      assigneeId: null,
      createdAt: '2026-07-27T10:00:00.000Z',
      updatedAt: '2026-07-27T10:00:00.000Z',
      ...overrides,
    },
    comments: [
      {
        id: 'c1',
        authorId: 'staff1',
        body: 'Looking into it.',
        internal: false,
        createdAt: '2026-07-27T11:00:00.000Z',
      },
      {
        id: 'c2',
        authorId: 'staff1',
        body: 'Vendor ticket opened.',
        internal: true,
        createdAt: '2026-07-27T11:05:00.000Z',
      },
    ],
    history: [
      {
        action: 'created',
        detail: null,
        createdAt: '2026-07-27T10:00:00.000Z',
      },
      {
        action: 'status_changed',
        detail: 'open → in_progress',
        createdAt: '2026-07-27T11:00:00.000Z',
      },
    ],
  };
}

interface Scripted {
  status: number;
  body: unknown;
}

function mockFetch(routes: Array<[matcher: RegExp, response: Scripted]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const match = routes.find(([pattern]) => pattern.test(url));
      const scripted = match?.[1] ?? { status: 404, body: {} };
      return {
        ok: scripted.status >= 200 && scripted.status < 300,
        status: scripted.status,
        json: async () => scripted.body,
      } as Response;
    },
  ) as unknown as typeof fetch;
  return calls;
}

function renderPage() {
  return render(
    <AuthProvider>
      <TicketDetailPage />
    </AuthProvider>,
  );
}

describe('TicketDetailPage', () => {
  it('renders the ticket with badges, comments and humanized history', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: USER_SESSION }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails() }],
    ]);

    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Broken printer' }),
    ).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
    expect(
      screen.getByText('It shows a paper jam that is not there.'),
    ).toBeTruthy();
    expect(screen.getByText('Looking into it.')).toBeTruthy();
    // Internal notes are labeled as such.
    expect(screen.getByText('Internal note')).toBeTruthy();
    // History actions are humanized: status_changed → "Status changed".
    expect(screen.getByText('Status changed')).toBeTruthy();
  });

  it('lets staff run a transition and announces the new status', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: AGENT_SESSION }],
      [/\/tickets\/t1\/status$/, { status: 200, body: makeDetails().ticket }],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails() }],
    ]);

    renderPage();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start progress' }),
    );

    await waitFor(() => {
      const patch = calls.find(
        (c) =>
          c.url.endsWith('/tickets/t1/status') && c.init?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String(patch?.init?.body))).toEqual({
        status: 'in_progress',
      });
    });
    expect((await screen.findByRole('status')).textContent).toBe(
      'Status changed to In progress',
    );
  });

  it('offers requesters exactly the confirm-and-close action on resolved tickets', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: USER_SESSION }],
      [
        /\/tickets\/t1$/,
        { status: 200, body: makeDetails({ status: 'resolved' }) },
      ],
    ]);

    renderPage();

    expect(
      await screen.findByRole('button', { name: 'Confirm fix and close' }),
    ).toBeTruthy();
    // Requesters never see the staff transition group.
    expect(screen.queryByRole('button', { name: 'Reopen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('posts a comment and reloads the thread', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: USER_SESSION }],
      [
        /\/tickets\/t1\/comments$/,
        {
          status: 201,
          body: {
            id: 'c9',
            authorId: 'u1',
            body: 'Any update?',
            internal: false,
            createdAt: '2026-07-27T12:00:00.000Z',
          },
        },
      ],
      [/\/tickets\/t1$/, { status: 200, body: makeDetails() }],
    ]);

    renderPage();

    fireEvent.change(await screen.findByLabelText('Add a comment'), {
      target: { value: 'Any update?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => {
      const post = calls.find(
        (c) =>
          c.url.endsWith('/tickets/t1/comments') && c.init?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        body: 'Any update?',
      });
    });
    // The textarea clears after a successful post.
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Add a comment') as HTMLTextAreaElement).value,
      ).toBe(''),
    );
  });
});
