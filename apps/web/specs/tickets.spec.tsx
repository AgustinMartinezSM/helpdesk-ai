import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import TicketsPage from '../src/app/tickets/page';
import NewTicketPage from '../src/app/tickets/new/page';

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

    expect(await screen.findByText('Broken printer')).toBeTruthy();
    expect(screen.getByText('[open] · high')).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/t9'));

    const createCall = calls.find(
      (c) => c.url.endsWith('/tickets') && c.init?.method === 'POST',
    );
    expect(createCall).toBeDefined();
    expect(
      (createCall?.init?.headers as Record<string, string>).authorization,
    ).toBe('Bearer jwt');
  });
});
