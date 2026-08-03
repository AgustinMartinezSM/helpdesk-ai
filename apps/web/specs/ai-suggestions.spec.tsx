import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import TicketDetailPage from '../src/app/(app)/tickets/[id]/page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: 't1' }),
}));

const REQUESTER_SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: 'org-1',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

const AGENT_SESSION = {
  ...REQUESTER_SESSION,
  accessToken: 'agent-jwt',
  permissions: ['tickets.change_status', 'tickets.note_internal'],
  user: { id: 'staff1', email: 's@b.com', roles: ['agent'] },
};

const DETAILS = {
  ticket: {
    id: 't1',
    title: 'Cannot sign in',
    description: 'Every attempt fails since the password reset.',
    status: 'open',
    priority: 'medium',
    category: null,
    requesterId: 'u1',
    assigneeId: null,
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T10:00:00.000Z',
  },
  comments: [],
  history: [],
};

const SUMMARY_SUGGESTION = {
  id: 's1',
  ticketId: 't1',
  task: 'summary',
  output: {
    text: 'Cannot sign in: every attempt fails since the password reset.',
    bullets: ['Reads as: account access'],
  },
  provider: 'local',
  model: 'heuristics-v1',
  usage: null,
  latencyMs: 3,
  contextHash: 'a'.repeat(64),
  requestedBy: 'staff1',
  createdAt: '2026-07-29T10:05:00.000Z',
};

const PRIORITY_SUGGESTION = {
  ...SUMMARY_SUGGESTION,
  id: 's2',
  task: 'priority',
  output: {
    priority: 'high',
    confidence: 0.5,
    rationale: 'Urgency wording suggests one step above medium.',
  },
};

interface Route {
  method: 'GET' | 'POST' | 'PATCH';
  pattern: RegExp;
  status: number;
  body: unknown;
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockFetch(routes: Route[]): Call[] {
  const calls: Call[] = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      const route = routes.find(
        (candidate) =>
          candidate.method === method && candidate.pattern.test(url),
      );
      const scripted = route ?? { status: 404, body: {} };
      return {
        ok: scripted.status >= 200 && scripted.status < 300,
        status: scripted.status,
        json: async () => scripted.body,
      } as Response;
    },
  ) as unknown as typeof fetch;
  return calls;
}

function baseRoutes(session: unknown, suggestions: unknown[] = []): Route[] {
  return [
    {
      method: 'POST',
      pattern: /\/session\/refresh$/,
      status: 200,
      body: session,
    },
    { method: 'GET', pattern: /\/tickets\/t1$/, status: 200, body: DETAILS },
    {
      method: 'GET',
      pattern: /\/ai\/provider$/,
      status: 200,
      body: { id: 'local', model: 'heuristics-v1' },
    },
    {
      method: 'GET',
      pattern: /\/ai\/tickets\/t1\/suggestions$/,
      status: 200,
      body: suggestions,
    },
  ];
}

function renderPage() {
  return render(
    <AuthProvider>
      <TicketDetailPage />
    </AuthProvider>,
  );
}

describe('AI suggestions panel', () => {
  it('is not offered to the person who opened the ticket', async () => {
    mockFetch(baseRoutes(REQUESTER_SESSION));

    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Cannot sign in' }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /AI assistance/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Generate / })).toBeNull();
  });

  it('offers staff the four tasks, none of them generated yet', async () => {
    mockFetch(baseRoutes(AGENT_SESSION));

    renderPage();

    expect(
      await screen.findByRole('heading', { name: /AI assistance/ }),
    ).toBeTruthy();

    for (const label of ['Summary', 'Category', 'Priority', 'Reply draft']) {
      expect(screen.getByRole('heading', { name: label })).toBeTruthy();
    }
    expect(screen.getAllByRole('button', { name: /^Generate / })).toHaveLength(
      4,
    );
    // Each button says which task it runs, so four identical stops become
    // four distinguishable ones.
    for (const label of [
      'Generate summary',
      'Generate category',
      'Generate priority',
      'Generate reply draft',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getAllByText('Not generated yet.')).toHaveLength(4);
  });

  it('says plainly that no language model is connected', async () => {
    mockFetch(baseRoutes(AGENT_SESSION));

    renderPage();

    expect(
      await screen.findByText(/No language model is connected/),
    ).toBeTruthy();
    expect(screen.getByText('heuristics-v1')).toBeTruthy();
    expect(screen.getByText(/placeholder/)).toBeTruthy();
  });

  it('names the provider when a real one is connected', async () => {
    // The first matching route wins, so this one shadows the local default.
    mockFetch([
      {
        method: 'GET',
        pattern: /\/ai\/provider$/,
        status: 200,
        body: { id: 'acme-ai', model: 'acme-large' },
      },
      ...baseRoutes(AGENT_SESSION),
    ]);

    renderPage();

    expect(await screen.findByText('acme-ai')).toBeTruthy();
    expect(screen.getByText('acme-large')).toBeTruthy();
    expect(screen.queryByText(/No language model is connected/)).toBeNull();
  });

  it('shows suggestions that already exist for the ticket', async () => {
    mockFetch(
      baseRoutes(AGENT_SESSION, [SUMMARY_SUGGESTION, PRIORITY_SUGGESTION]),
    );

    renderPage();

    expect(
      await screen.findByText(
        'Cannot sign in: every attempt fails since the password reset.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Reads as: account access')).toBeTruthy();
    // The priority suggestion is shown with its label and the provider's own
    // confidence claim, labeled as the provider's.
    expect(screen.getByText('High')).toBeTruthy();
    expect(screen.getByText('provider confidence 50%')).toBeTruthy();
    // Attribution travels with every suggestion.
    expect(screen.getAllByText(/local · heuristics-v1/).length).toBeGreaterThan(
      0,
    );
    // Two tasks answered, two still offered.
    expect(
      screen.getByRole('button', { name: 'Regenerate summary' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Regenerate priority' }),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Generate / })).toHaveLength(
      2,
    );
  });

  it('generates one suggestion on request and never touches the ticket', async () => {
    const calls = mockFetch([
      ...baseRoutes(AGENT_SESSION),
      {
        method: 'POST',
        pattern: /\/ai\/tickets\/t1\/suggestions$/,
        status: 201,
        body: SUMMARY_SUGGESTION,
      },
    ]);

    renderPage();

    await screen.findByRole('heading', { name: /AI assistance/ });
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }));

    expect(
      await screen.findByText(
        'Cannot sign in: every attempt fails since the password reset.',
      ),
    ).toBeTruthy();

    const post = calls.find(
      (call) =>
        call.method === 'POST' &&
        call.url.endsWith('/ai/tickets/t1/suggestions'),
    );
    expect(post?.body).toEqual({ task: 'summary' });
    // The panel is advisory: nothing it does writes to the ticket. Only the
    // tickets API counts here — /ai/tickets/... is this panel's own route.
    expect(
      calls.filter(
        (call) =>
          call.method !== 'GET' &&
          new URL(call.url).pathname.startsWith('/tickets/'),
      ),
    ).toEqual([]);
  });

  it('reports a failure on the task that failed, and keeps the others usable', async () => {
    mockFetch([
      ...baseRoutes(AGENT_SESSION),
      {
        method: 'POST',
        pattern: /\/ai\/tickets\/t1\/suggestions$/,
        status: 503,
        body: {
          statusCode: 503,
          message: 'the local provider could not answer (timeout)',
        },
      },
    ]);

    renderPage();

    await screen.findByRole('heading', { name: /AI assistance/ });
    fireEvent.click(screen.getByRole('button', { name: 'Generate summary' }));

    expect(
      await screen.findByText(/the local provider could not answer/),
    ).toBeTruthy();
    // Failure is local to one task: the rest are untouched and still offered.
    expect(screen.getAllByText('Not generated yet.')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /^Generate / })).toHaveLength(
      4,
    );
  });

  it('reports an unreachable service once, for the whole panel', async () => {
    mockFetch([
      {
        method: 'POST',
        pattern: /\/session\/refresh$/,
        status: 200,
        body: AGENT_SESSION,
      },
      { method: 'GET', pattern: /\/tickets\/t1$/, status: 200, body: DETAILS },
      {
        method: 'GET',
        pattern: /\/ai\/provider$/,
        status: 502,
        body: {
          statusCode: 502,
          message: 'The platform is temporarily unavailable',
        },
      },
    ]);

    renderPage();

    expect(
      await screen.findByText('The platform is temporarily unavailable'),
    ).toBeTruthy();
  });
});
