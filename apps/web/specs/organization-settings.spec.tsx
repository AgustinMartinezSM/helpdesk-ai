import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import OrganizationPage from '../src/app/(app)/organization/page';

/**
 * The organization's own name and ownership (Sprint 10.5, ADR 0024).
 *
 * The property most of this file exists to pin: **an owner and an
 * administrator carry identical permissions**, so nothing the browser can read
 * out of the session distinguishes them. The ownership control is rendered from
 * `viewerIsOwner`, which the server answers from the stored row — and these
 * tests give both sessions the same permission array on purpose, so a
 * regression that started gating on a permission key fails here.
 */

const OWNER_ID = 'u1';
const SUCCESSOR_ID = 'u2';

/**
 * Owner and administrator, byte-identical apart from the user id. That is not
 * a shortcut in the fixture — it is what the permission map actually resolves
 * for these two templates.
 */
const ADMIN_PERMISSIONS = [
  'organization.read',
  'organization.update',
  'people.read',
  'branches.read',
];

const OWNER_SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: ADMIN_PERMISSIONS,
  organizationId: 'org-1',
  user: { id: OWNER_ID, email: 'titular@empresa.com', roles: ['user'] },
};

const ADMIN_SESSION = {
  ...OWNER_SESSION,
  user: { id: SUCCESSOR_ID, email: 'admin@empresa.com', roles: ['user'] },
};

const AGENT_SESSION = {
  ...OWNER_SESSION,
  permissions: ['organization.read', 'tickets.read_own'],
};

const ORGANIZATION = {
  organizationId: 'org-1',
  slug: 'ferreteria-sur',
  name: 'Ferretería Sur',
  viewerIsOwner: true,
};

const DIRECTORY = [
  {
    userId: OWNER_ID,
    email: 'titular@empresa.com',
    displayName: 'Ada Lovelace',
    preferredName: null,
    phone: null,
    registeredAt: '2026-08-01T12:00:00.000Z',
    roleTemplate: 'owner',
    status: 'active' as const,
  },
  {
    userId: SUCCESSOR_ID,
    email: 'grace@empresa.com',
    displayName: 'Grace Hopper',
    preferredName: null,
    phone: null,
    registeredAt: '2026-08-01T12:00:00.000Z',
    roleTemplate: 'organization_admin',
    status: 'active' as const,
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

function renderPage() {
  return render(
    <AuthProvider>
      <OrganizationPage />
    </AuthProvider>,
  );
}

const BASE_ROUTES = (
  session: unknown,
  organization: unknown,
): Array<[RegExp, Scripted, string?]> => [
  [/\/session\/refresh$/, { status: 200, body: session }],
  [/\/organization\/current$/, { status: 200, body: organization }, 'GET'],
  [/\/people$/, { status: 200, body: DIRECTORY }, 'GET'],
  [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
  [/\/organization\/teams$/, { status: 200, body: [] }, 'GET'],
];

describe('the organization name', () => {
  it('shows the current name and says the internal key will not change', async () => {
    mockFetch(BASE_ROUTES(OWNER_SESSION, ORGANIZATION));
    renderPage();

    const form = await screen.findByLabelText('organization name form');
    expect(
      (screen.getByLabelText('Organization name') as HTMLInputElement).value,
    ).toBe('Ferretería Sur');
    // The promise the product can actually keep, stated where somebody is
    // about to rely on it.
    expect(form.textContent).toMatch(/does not change/i);
    expect(form.textContent).toContain('ferreteria-sur');
    // And it must NOT promise that the address changes with the name.
    expect(form.textContent).not.toMatch(/new address|url will change/i);
  });

  it('saves only on submit, and shows the name the server came back with', async () => {
    const calls = mockFetch([
      ...BASE_ROUTES(OWNER_SESSION, ORGANIZATION),
      [
        /\/organization\/current$/,
        {
          status: 200,
          body: {
            organizationId: 'org-1',
            slug: 'ferreteria-sur',
            name: 'Ferretería Sur S.R.L.',
          },
        },
        'PATCH',
      ],
    ]);
    renderPage();

    await screen.findByLabelText('organization name form');
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: '  Ferretería Sur S.R.L.  ' },
    });
    // Typing is not saving.
    expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.init?.method === 'PATCH' &&
            call.url.endsWith('/organization/current') &&
            // Trimmed by the browser, normalised again by the server.
            String(call.init?.body).includes('Ferretería Sur S.R.L.'),
        ),
      ).toBe(true),
    );
    // The server's value wins, not the one that was typed.
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Organization name') as HTMLInputElement).value,
      ).toBe('Ferretería Sur S.R.L.'),
    );
  });

  it('never offers to edit the internal key', async () => {
    mockFetch(BASE_ROUTES(OWNER_SESSION, ORGANIZATION));
    renderPage();

    await screen.findByLabelText('organization name form');
    expect(screen.queryByLabelText(/slug/i)).toBeNull();
  });

  it('renders the refusal when the server says no', async () => {
    // A 403 is reachable with a correct screen: the session's permission list
    // is a snapshot and goes stale with the token (ADR 0020).
    mockFetch([
      ...BASE_ROUTES(OWNER_SESSION, ORGANIZATION),
      [
        /\/organization\/current$/,
        {
          status: 403,
          body: { message: 'you are not allowed to change this organization' },
        },
        'PATCH',
      ],
    ]);
    renderPage();

    await screen.findByLabelText('organization name form');
    fireEvent.change(screen.getByLabelText('Organization name'), {
      target: { value: 'Something else' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /not allowed/i,
    );
  });

  it('is not rendered for a member without organization.update', async () => {
    mockFetch(
      BASE_ROUTES(AGENT_SESSION, { ...ORGANIZATION, viewerIsOwner: false }),
    );
    renderPage();

    expect(
      await screen.findByText(/do not manage this organization/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText('organization name form')).toBeNull();
  });
});

describe('transferring ownership', () => {
  it('is offered to the owner', async () => {
    mockFetch(BASE_ROUTES(OWNER_SESSION, ORGANIZATION));
    renderPage();

    expect(await screen.findByLabelText('Hand it to')).toBeTruthy();
  });

  it('is NOT offered to an administrator holding identical permissions', async () => {
    // The point of the whole design. Same permission array, different answer,
    // because the answer comes from the server's read of the stored row.
    mockFetch(
      BASE_ROUTES(ADMIN_SESSION, { ...ORGANIZATION, viewerIsOwner: false }),
    );
    renderPage();

    // The rename card still appears — they do administer the organization.
    await screen.findByLabelText('organization name form');
    expect(screen.queryByLabelText('Hand it to')).toBeNull();
  });

  it('offers only other people, never the owner themselves', async () => {
    mockFetch(BASE_ROUTES(OWNER_SESSION, ORGANIZATION));
    renderPage();

    const picker = (await screen.findByLabelText(
      'Hand it to',
    )) as HTMLSelectElement;
    const values = [...picker.options].map((option) => option.value);
    expect(values).toContain(SUCCESSOR_ID);
    expect(values).not.toContain(OWNER_ID);
  });

  it('says what ownership means and what happens to the person handing it over', async () => {
    mockFetch(BASE_ROUTES(OWNER_SESSION, ORGANIZATION));
    renderPage();

    await screen.findByLabelText('Hand it to');
    const panel = screen.getByText(/^Ownership$/).parentElement as HTMLElement;
    expect(panel.textContent).toMatch(/nobody can change or remove the owner/i);
    expect(panel.textContent).toMatch(/you become an administrator/i);
  });

  it('requires an explicit confirmation, and the first click sends nothing', async () => {
    const calls = mockFetch(BASE_ROUTES(OWNER_SESSION, ORGANIZATION));
    renderPage();

    fireEvent.change(await screen.findByLabelText('Hand it to'), {
      target: { value: SUCCESSOR_ID },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /^Transfer ownership/ }),
    );

    // Armed, not fired. An irreversible act does not happen on one click.
    expect(screen.getByText(/Give Grace Hopper ownership/)).toBeTruthy();
    expect(calls.some((call) => call.url.includes('/ownership/transfer'))).toBe(
      false,
    );
  });

  it('names the subject on both controls, for anyone not reading the question', async () => {
    // A page can hold several confirmations; "Yes, transfer it" alone is
    // unusable through a screen reader (the ConfirmAction contract).
    mockFetch(BASE_ROUTES(OWNER_SESSION, ORGANIZATION));
    renderPage();

    fireEvent.change(await screen.findByLabelText('Hand it to'), {
      target: { value: SUCCESSOR_ID },
    });
    const arm = await screen.findByRole('button', {
      name: 'Transfer ownership — Transfer ownership of Ferretería Sur to Grace Hopper',
    });
    fireEvent.click(arm);

    expect(
      screen.getByRole('button', {
        name: 'Yes, transfer it — Transfer ownership of Ferretería Sur to Grace Hopper',
      }),
    ).toBeTruthy();
    // And it can be abandoned.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/Give Grace Hopper ownership/)).toBeNull();
  });

  it('refreshes the session BEFORE re-reading, then stops offering the control', async () => {
    const calls = mockFetch([
      [/\/session\/refresh$/, { status: 200, body: OWNER_SESSION }],
      [/\/people$/, { status: 200, body: DIRECTORY }, 'GET'],
      [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
      [/\/organization\/teams$/, { status: 200, body: [] }, 'GET'],
      [
        /\/organization\/ownership\/transfer$/,
        {
          status: 200,
          body: {
            organizationId: 'org-1',
            previousOwnerUserId: OWNER_ID,
            newOwnerUserId: SUCCESSOR_ID,
            sessionRefreshRequired: true,
          },
        },
        'POST',
      ],
      // The organization read answers viewerIsOwner: true the first time and
      // false afterwards, which is what the real service would do.
      [/\/organization\/current$/, { status: 200, body: ORGANIZATION }, 'GET'],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Hand it to'), {
      target: { value: SUCCESSOR_ID },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /^Transfer ownership/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Yes, transfer it/ }));

    await waitFor(() =>
      expect(
        calls.some((call) => call.url.includes('/ownership/transfer')),
      ).toBe(true),
    );

    // The person who just confirmed has demoted themselves, and their token
    // still says otherwise. A refresh has to follow the write, or every
    // control on the screen keeps rendering from a claim the server refuses.
    const transferAt = calls.findIndex((call) =>
      call.url.includes('/ownership/transfer'),
    );
    await waitFor(() =>
      expect(
        calls
          .slice(transferAt + 1)
          .some((call) => call.url.includes('/session/refresh')),
      ).toBe(true),
    );
  });

  it('does not change the screen when the backend refuses', async () => {
    // Nothing optimistic: a 409 means somebody else moved the ownership while
    // this screen was open, and the panel has to still be here afterwards.
    mockFetch([
      ...BASE_ROUTES(OWNER_SESSION, ORGANIZATION),
      [
        /\/organization\/ownership\/transfer$/,
        {
          status: 409,
          body: {
            message:
              "this organization's ownership changed while you were deciding; read it again and start over",
          },
        },
        'POST',
      ],
    ]);
    renderPage();

    fireEvent.change(await screen.findByLabelText('Hand it to'), {
      target: { value: SUCCESSOR_ID },
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /^Transfer ownership/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Yes, transfer it/ }));

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /ownership changed while you were deciding/i,
    );
    expect(screen.getByLabelText('Hand it to')).toBeTruthy();
  });

  it('says the list failed rather than showing an empty picker', async () => {
    // "Nobody works here" and "the directory did not load" must not look the
    // same on the screen whose next control gives the organization away.
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: OWNER_SESSION }],
      [/\/organization\/current$/, { status: 200, body: ORGANIZATION }, 'GET'],
      [/\/people$/, { status: 500, body: {} }, 'GET'],
      [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
    ]);
    renderPage();

    expect(
      await screen.findByText(/list of people could not be loaded/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Hand it to')).toBeNull();
  });

  it('explains itself when the owner is alone in the organization', async () => {
    mockFetch([
      [/\/session\/refresh$/, { status: 200, body: OWNER_SESSION }],
      [/\/organization\/current$/, { status: 200, body: ORGANIZATION }, 'GET'],
      [/\/people$/, { status: 200, body: [DIRECTORY[0]] }, 'GET'],
      [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
    ]);
    renderPage();

    expect(await screen.findByText(/nobody else here yet/i)).toBeTruthy();
    expect(screen.queryByLabelText('Hand it to')).toBeNull();
  });
});
