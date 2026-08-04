import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import { AppShell } from '../src/components/app-shell';
import NewOrganizationPage from '../src/app/(app)/organization/new/page';

/**
 * Choosing which organization you are working in (Sprint 10.6, ADR 0025).
 *
 * The property most of this file pins: the switcher is rendered from the
 * SERVER'S list and the session's organization, never from anything the
 * browser decided. And it appears only when there is a second place to go —
 * the header is unchanged for every account that belongs to one organization,
 * which is all of them until now.
 */

const ACME = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';

const SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: ['organization.read'],
  organizationId: ACME,
  user: { id: 'u1', email: 'ada@empresa.com', roles: ['user'] },
};

const BOTH = [
  {
    organizationId: ACME,
    slug: 'acme',
    name: 'Acme',
    roleTemplate: 'owner',
  },
  {
    organizationId: OTHER,
    slug: 'other',
    name: 'Ferretería Sur',
    roleTemplate: 'agent',
  },
];

interface Scripted {
  status: number;
  body: unknown;
}

function mockFetch(
  routes: Array<[matcher: RegExp, response: Scripted, method?: string]>,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const method = init?.method ?? 'GET';
      const match = routes.find(
        ([pattern, , forMethod]) =>
          pattern.test(url) && (!forMethod || forMethod === method),
      );
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

function renderShell() {
  return render(
    <AuthProvider>
      <AppShell>
        <p>content</p>
      </AppShell>
    </AuthProvider>,
  );
}

describe('the organization switcher', () => {
  it('offers every organization the server listed', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/organization\/mine$/,
        { status: 200, body: { organizations: BOTH } },
        'GET',
      ],
    ]);
    renderShell();

    const picker = (await screen.findByLabelText(
      'Organization',
    )) as HTMLSelectElement;

    expect([...picker.options].map((option) => option.value)).toEqual([
      ACME,
      OTHER,
    ]);
    // It shows where you ARE, from the session — not the first entry.
    expect(picker.value).toBe(ACME);
  });

  it('is NOT rendered for somebody who belongs to one organization', async () => {
    // One organization is not a choice, and a picker with one entry is a
    // control that does nothing. The header stays exactly as it was.
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/organization\/mine$/,
        { status: 200, body: { organizations: [BOTH[0]] } },
        'GET',
      ],
    ]);
    renderShell();

    await screen.findByText('content');
    expect(screen.queryByLabelText('Organization')).toBeNull();
  });

  it('is not rendered when the person belongs nowhere', async () => {
    mockFetch([
      [
        /\/session\/refresh$/,
        { status: 200, body: { ...SESSION, organizationId: null } },
      ],
      [
        /\/organization\/mine$/,
        { status: 200, body: { organizations: [] } },
        'GET',
      ],
    ]);
    renderShell();

    await screen.findByText('content');
    expect(screen.queryByLabelText('Organization')).toBeNull();
  });

  it('is not rendered when the list cannot be loaded', async () => {
    // Failing to load it means no switcher, never a header that cannot render.
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [/\/organization\/mine$/, { status: 500, body: {} }, 'GET'],
    ]);
    renderShell();

    await screen.findByText('content');
    expect(screen.queryByLabelText('Organization')).toBeNull();
  });

  it('asks the SERVER to switch, and renders what it gets back', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/organization\/mine$/,
        { status: 200, body: { organizations: BOTH } },
        'GET',
      ],
      [
        /\/session\/organization$/,
        { status: 200, body: { ...SESSION, organizationId: OTHER } },
        'POST',
      ],
    ]);
    renderShell();

    const picker = await screen.findByLabelText('Organization');
    fireEvent.change(picker, { target: { value: OTHER } });

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'POST' &&
            call.url.endsWith('/session/organization') &&
            String(call.init?.body).includes(OTHER),
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Organization') as HTMLSelectElement).value,
      ).toBe(OTHER),
    );
  });

  it('sends credentials, so the BFF can remember the choice', async () => {
    // The cookie the BFF writes is what makes the next page load resume here
    // rather than falling back to the default organization.
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/organization\/mine$/,
        { status: 200, body: { organizations: BOTH } },
        'GET',
      ],
      [
        /\/session\/organization$/,
        { status: 200, body: { ...SESSION, organizationId: OTHER } },
        'POST',
      ],
    ]);
    renderShell();

    fireEvent.change(await screen.findByLabelText('Organization'), {
      target: { value: OTHER },
    });

    await waitFor(() => {
      const call = calls.find((entry) =>
        entry.url.endsWith('/session/organization'),
      );
      expect(call?.init?.credentials).toBe('include');
    });
  });

  it('shows a refusal and stays where it was', async () => {
    // A 404 means the organization stopped being available while the header
    // was open. Nothing optimistic: the person is still where they were, and
    // the control has to agree with that.
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/organization\/mine$/,
        { status: 200, body: { organizations: BOTH } },
        'GET',
      ],
      [
        /\/session\/organization$/,
        {
          status: 404,
          body: {
            message: 'That organization is not available to this account',
          },
        },
        'POST',
      ],
    ]);
    renderShell();

    fireEvent.change(await screen.findByLabelText('Organization'), {
      target: { value: OTHER },
    });

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /not available/i,
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Organization') as HTMLSelectElement).value,
      ).toBe(ACME),
    );
  });

  it('does not sign anybody out when a switch is refused', async () => {
    // A failed switch is not a dead session. Treating it like one would sign
    // somebody out of a session that is perfectly valid.
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/organization\/mine$/,
        { status: 200, body: { organizations: BOTH } },
        'GET',
      ],
      [/\/session\/organization$/, { status: 404, body: {} }, 'POST'],
    ]);
    renderShell();

    fireEvent.change(await screen.findByLabelText('Organization'), {
      target: { value: OTHER },
    });

    await screen.findByRole('alert');
    expect(screen.getByLabelText('Account menu')).toBeTruthy();
  });
});

describe('creating a second organization', () => {
  function renderCreate() {
    return render(
      <AuthProvider>
        <NewOrganizationPage />
      </AuthProvider>,
    );
  }

  it('SWITCHES into what it just created, rather than refreshing', async () => {
    /**
     * The line that stops Sprint 10.6 from shipping the stranded organization
     * ADR 0023's refusal existed to prevent. A refresh re-runs the default
     * rule and returns the OLDEST organization; for somebody who already
     * belonged somewhere that is not the one they just made.
     */
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: SESSION }],
      [
        /\/organization$/,
        {
          status: 201,
          body: {
            organizationId: OTHER,
            slug: 'ferreteria-sur',
            name: 'Ferretería Sur',
            sessionRefreshRequired: true,
          },
        },
        'POST',
      ],
      [
        /\/session\/organization$/,
        { status: 200, body: { ...SESSION, organizationId: OTHER } },
        'POST',
      ],
    ]);
    renderCreate();

    fireEvent.change(await screen.findByLabelText('Organization name'), {
      target: { value: 'Ferretería Sur' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create organization' }),
    );

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.url.endsWith('/session/organization') &&
            String(call.init?.body).includes(OTHER),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText(/Ferretería Sur is ready/)).toBeTruthy();
  });

  it('no longer says the name cannot be changed', async () => {
    mockFetch([[/\/session\/refresh$/, { status: 200, body: SESSION }]]);
    renderCreate();

    const hint = await screen.findByText(/internal key/i);
    expect(hint.textContent).toMatch(/can change this name later/i);
  });
});
