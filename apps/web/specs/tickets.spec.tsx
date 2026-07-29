import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import TicketsPage from '../src/app/(app)/tickets/page';
import NewTicketPage from '../src/app/(app)/tickets/new/page';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: 't1' }),
}));

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

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

describe('TicketsPage', () => {
  it('lists the signed-in user tickets with status and priority', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/tickets$/,
        {
          status: 200,
          body: {
            total: 1,
            items: [
              {
                id: 't1',
                title: 'Broken printer',
                status: 'open',
                priority: 'high',
                createdAt: '2026-07-27T10:00:00.000Z',
              },
            ],
          },
        },
      ],
    ]);

    render(
      <AuthProvider>
        <TicketsPage />
      </AuthProvider>,
    );

    // Scope to the row: the status filter pills also render "Open".
    const row = (await screen.findByText('Broken printer')).closest('a');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Open')).toBeTruthy();
    expect(within(row as HTMLElement).getByText('High')).toBeTruthy();
  });

  it('shows a loading skeleton while tickets are being fetched', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/session\/refresh$/.test(url)) {
        return {
          ok: true,
          status: 200,
          json: async () => SESSION,
        } as Response;
      }
      // The tickets request never resolves — the skeleton must stay up.
      return new Promise(() => undefined) as never;
    }) as unknown as typeof fetch;

    render(
      <AuthProvider>
        <TicketsPage />
      </AuthProvider>,
    );

    // Wait for the authenticated header first: the auth-restore phase
    // shows an identical skeleton, and asserting before the heading
    // appears would match that one and pass vacuously.
    await screen.findByRole('heading', { name: 'Tickets' });
    expect(
      screen.getByRole('status', { name: 'Loading tickets' }),
    ).toBeTruthy();
  });

  it('reloads the list with the selected status filter', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [/\/tickets(\?.*)?$/, { status: 200, body: { total: 0, items: [] } }],
    ]);

    render(
      <AuthProvider>
        <TicketsPage />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'In progress' }));

    await waitFor(() =>
      expect(
        calls.some((c) => c.url.endsWith('/tickets?status=in_progress')),
      ).toBe(true),
    );
    // Filtered queries get the "adjust the filter" empty state, not the CTA.
    expect(await screen.findByText('No matching tickets')).toBeTruthy();
  });

  it('offers the create CTA when the unfiltered list is empty', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [/\/tickets$/, { status: 200, body: { total: 0, items: [] } }],
    ]);

    render(
      <AuthProvider>
        <TicketsPage />
      </AuthProvider>,
    );

    expect(await screen.findByText('No tickets yet')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Create your first ticket' }),
    ).toBeTruthy();
  });

  it('prompts anonymous visitors to sign in without calling the tickets API', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 401, body: {} }],
    ]);

    render(
      <AuthProvider>
        <TicketsPage />
      </AuthProvider>,
    );

    expect(await screen.findByText('Sign in')).toBeTruthy();
    expect(calls.some((c) => c.url.endsWith('/tickets'))).toBe(false);
  });
});

describe('NewTicketPage', () => {
  it('creates a ticket through the BFF and navigates to its detail', async () => {
    push.mockClear();
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [/\/tickets$/, { status: 201, body: { id: 't9', status: 'open' } }],
    ]);

    render(
      <AuthProvider>
        <NewTicketPage />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'VPN drops constantly' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Disconnects every five minutes on the office wifi.' },
    });
    // Segmented radio-pills: the label text selects the priority.
    fireEvent.click(screen.getByLabelText('High'));
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/t9'));

    const createCall = calls.find(
      (c) => c.url.endsWith('/tickets') && c.init?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    const headers = createCall?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer jwt');
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(createCall?.init?.body))).toEqual({
      title: 'VPN drops constantly',
      description: 'Disconnects every five minutes on the office wifi.',
      priority: 'high',
    });
  });
});
