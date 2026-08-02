import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import NewTicketPage from '../src/app/(app)/tickets/new/page';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

const BRANCH = {
  id: '00000000-0000-4000-8000-0000000000b1',
  code: 'BR-12',
  name: 'Store 12',
};
const STATION = {
  id: '00000000-0000-4000-8000-0000000000e1',
  code: 'CASH-2',
  name: 'Cashier station 2',
  area: 'checkout',
};

function mockFetchRoutes(
  routes: Record<string, { status: number; body: unknown }>,
) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = Object.entries(routes).find(([suffix]) =>
      url.endsWith(suffix),
    );
    const scripted = match?.[1] ?? { status: 404, body: {} };
    return {
      ok: scripted.status >= 200 && scripted.status < 300,
      status: scripted.status,
      json: async () => scripted.body,
    } as Response;
  }) as unknown as typeof fetch;
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Title'), {
    target: { value: 'Card terminal down' },
  });
  fireEvent.change(screen.getByLabelText('Description'), {
    target: { value: 'Cashier 2 cannot process payments since this morning.' },
  });
}

function renderPage() {
  return render(
    <AuthProvider>
      <NewTicketPage />
    </AuthProvider>,
  );
}

describe('NewTicketPage location context', () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  it('renders exactly the plain form when the organization has no branches', async () => {
    mockFetchRoutes({
      '/session/refresh': { status: 200, body: SESSION },
      '/tickets/branches': { status: 200, body: [] },
    });

    renderPage();

    await screen.findByLabelText('Title');
    expect(screen.queryByLabelText('Location')).toBeNull();
  });

  it('submits the picked branch and station, and remembers the place for next time', async () => {
    mockFetchRoutes({
      '/session/refresh': { status: 200, body: SESSION },
      '/tickets/branches': { status: 200, body: [BRANCH] },
      [`/tickets/branches/${BRANCH.id}/stations`]: {
        status: 200,
        body: [STATION],
      },
      '/tickets': { status: 201, body: { id: 't1' } },
    });

    renderPage();

    const branchSelect = await screen.findByLabelText('Location');
    fireEvent.change(branchSelect, { target: { value: BRANCH.id } });
    const stationSelect = await screen.findByLabelText('Workstation');
    fireEvent.change(stationSelect, { target: { value: STATION.id } });
    fillRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/tickets/t1'));

    const createCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/tickets') &&
        (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(JSON.parse(createCall![1].body as string)).toMatchObject({
      branchId: BRANCH.id,
      stationId: STATION.id,
    });

    // The machine remembered the PLACE — ids and labels, nothing else.
    const stored = JSON.parse(
      window.localStorage.getItem('helpdesk.station-context') ?? '{}',
    );
    expect(stored).toEqual({
      branchId: BRANCH.id,
      branchLabel: 'Store 12 (BR-12)',
      stationId: STATION.id,
      stationLabel: 'Cashier station 2 (CASH-2)',
    });
    expect(JSON.stringify(stored)).not.toContain('jwt');
  });

  it('prefills the remembered place and can forget it', async () => {
    window.localStorage.setItem(
      'helpdesk.station-context',
      JSON.stringify({
        branchId: BRANCH.id,
        branchLabel: 'Store 12 (BR-12)',
        stationId: STATION.id,
        stationLabel: 'Cashier station 2 (CASH-2)',
      }),
    );
    mockFetchRoutes({
      '/session/refresh': { status: 200, body: SESSION },
      '/tickets/branches': { status: 200, body: [BRANCH] },
      [`/tickets/branches/${BRANCH.id}/stations`]: {
        status: 200,
        body: [STATION],
      },
    });

    renderPage();

    const branchSelect =
      await screen.findByLabelText<HTMLSelectElement>('Location');
    await waitFor(() => expect(branchSelect.value).toBe(BRANCH.id));
    expect(screen.getByText(/remembered its location/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Forget it' }));
    expect(branchSelect.value).toBe('');
    expect(window.localStorage.getItem('helpdesk.station-context')).toBeNull();
  });

  it('drops and forgets a remembered branch that no longer exists', async () => {
    window.localStorage.setItem(
      'helpdesk.station-context',
      JSON.stringify({
        branchId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        branchLabel: 'Closed store',
      }),
    );
    mockFetchRoutes({
      '/session/refresh': { status: 200, body: SESSION },
      '/tickets/branches': { status: 200, body: [BRANCH] },
    });

    renderPage();

    const branchSelect =
      await screen.findByLabelText<HTMLSelectElement>('Location');
    await waitFor(() =>
      expect(
        window.localStorage.getItem('helpdesk.station-context'),
      ).toBeNull(),
    );
    expect(branchSelect.value).toBe('');
  });
});
