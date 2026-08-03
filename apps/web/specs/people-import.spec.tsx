import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../src/components/auth-context';
import PeoplePage from '../src/app/(app)/people/page';
import {
  buildErrorReport,
  importFailureMessage,
  type ImportRowResult,
} from '../src/lib/people';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const BASE_SESSION = {
  accessToken: 'jwt',
  expiresInSeconds: 900,
  permissions: [] as string[],
  organizationId: 'org-1',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

/** owner / organization_admin: the only templates the matrix gives import to. */
const IMPORTER_SESSION = {
  ...BASE_SESSION,
  permissions: ['people.read', 'people.invite', 'people.import'],
};

/** Can invite one at a time and cannot import a file. */
const INVITER_SESSION = {
  ...BASE_SESSION,
  permissions: ['people.read', 'people.invite'],
};

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

function baseRoutes(session: unknown): Array<[RegExp, Scripted, string?]> {
  return [
    [/\/session\/refresh$/, { status: 200, body: session }],
    [/\/organization\/branches$/, { status: 200, body: [] }, 'GET'],
    [/\/people\/invitations$/, { status: 200, body: [] }, 'GET'],
    [
      /\/people\/role-templates$/,
      { status: 200, body: { roleTemplates: ['agent', 'requester'] } },
      'GET',
    ],
    [/\/people(\?|$)/, { status: 200, body: [] }, 'GET'],
  ];
}

function renderPage() {
  return render(
    <AuthProvider>
      <PeoplePage />
    </AuthProvider>,
  );
}

/** Drives the file input the way a person does, without a real File picker. */
function chooseFile(csv: string) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  const file = new File([csv], 'people.csv', { type: 'text/csv' });
  // jsdom's File has no text() in every version; the panel awaits it, so the
  // stub is what makes the read deterministic rather than timing-dependent.
  Object.defineProperty(file, 'text', { value: async () => csv });
  Object.defineProperty(input, 'files', { value: [file] });
  fireEvent.change(input);
}

describe('the import panel is gated on its own key', () => {
  it('appears for people.import', async () => {
    mockFetch(baseRoutes(IMPORTER_SESSION));
    renderPage();

    expect(await screen.findByText('Import from a file')).toBeTruthy();
  });

  it('does not appear for somebody who can only invite one at a time', async () => {
    mockFetch(baseRoutes(INVITER_SESSION));
    renderPage();

    // people.invite and people.import are different cells in the matrix, and
    // the two acts differ in blast radius rather than in kind.
    await screen.findByLabelText('invite form');
    expect(screen.queryByText('Import from a file')).toBeNull();
  });
});

describe('the import panel says what it does before it does it', () => {
  it('warns that nothing is sent, before a file is even chosen', async () => {
    mockFetch(baseRoutes(IMPORTER_SESSION));
    renderPage();

    // The same out-of-band delivery the single invitation has, multiplied by
    // the row count — said in advance, because afterwards is too late to plan
    // for two hundred codes.
    expect(await screen.findByText(/sends nothing/)).toBeTruthy();
    expect(screen.getByText(/one code per person/)).toBeTruthy();
  });

  it('says a branch or department is never created from a spelling', async () => {
    mockFetch(baseRoutes(IMPORTER_SESSION));
    renderPage();

    expect(
      await screen.findByText(/nothing\s+is created from a spelling/),
    ).toBeTruthy();
  });
});

describe('preview before apply', () => {
  const PREVIEW = {
    summary: {
      dryRun: true,
      total: 2,
      invited: 1,
      alreadyInvited: 1,
      alreadyMember: 0,
      failed: 0,
    },
    rows: [
      { line: 2, email: 'ada@x.com', outcome: { status: 'would_invite' } },
      { line: 3, email: 'alan@x.com', outcome: { status: 'already_invited' } },
    ],
  };

  it('checks the file first, and says nothing has been created yet', async () => {
    const calls = mockFetch([
      ...baseRoutes(IMPORTER_SESSION),
      [/\/people\/import\/preview$/, { status: 200, body: PREVIEW }, 'POST'],
    ]);
    renderPage();

    await screen.findByText('Import from a file');
    chooseFile('email\nada@x.com\nalan@x.com\n');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check the file' }),
    );

    expect(
      await screen.findByText(/Nothing has been created yet/),
    ).toBeTruthy();
    // The preview is its own endpoint. If it shared one with the apply,
    // "check the file" would write.
    expect(
      calls.some((call) => call.url.endsWith('/people/import/preview')),
    ).toBe(true);
    expect(calls.some((call) => call.url.endsWith('/people/import'))).toBe(
      false,
    );
  });

  it('offers to apply only what the preview said it would invite', async () => {
    mockFetch([
      ...baseRoutes(IMPORTER_SESSION),
      [/\/people\/import\/preview$/, { status: 200, body: PREVIEW }, 'POST'],
    ]);
    renderPage();

    await screen.findByText('Import from a file');
    chooseFile('email\nada@x.com\nalan@x.com\n');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check the file' }),
    );

    // One of the two rows is already invited, so the button offers one — the
    // count the administrator is agreeing to.
    expect(
      await screen.findByRole('button', { name: /Invite 1 person/ }),
    ).toBeTruthy();
  });

  it('offers no apply when the preview found nothing to do', async () => {
    mockFetch([
      ...baseRoutes(IMPORTER_SESSION),
      [
        /\/people\/import\/preview$/,
        {
          status: 200,
          body: {
            summary: {
              dryRun: true,
              total: 1,
              invited: 0,
              alreadyInvited: 1,
              alreadyMember: 0,
              failed: 0,
            },
            rows: [],
          },
        },
        'POST',
      ],
    ]);
    renderPage();

    await screen.findByText('Import from a file');
    chooseFile('email\nada@x.com\n');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check the file' }),
    );

    await screen.findByText(/already here/);
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();
  });
});

describe('applying, and the codes', () => {
  it('shows one code per invited row and says it is the only time', async () => {
    mockFetch([
      ...baseRoutes(IMPORTER_SESSION),
      [
        /\/people\/import\/preview$/,
        {
          status: 200,
          body: {
            summary: {
              dryRun: true,
              total: 1,
              invited: 1,
              alreadyInvited: 0,
              alreadyMember: 0,
              failed: 0,
            },
            rows: [
              {
                line: 2,
                email: 'ada@x.com',
                outcome: { status: 'would_invite' },
              },
            ],
          },
        },
        'POST',
      ],
      [
        /\/people\/import$/,
        {
          status: 200,
          body: {
            summary: {
              dryRun: false,
              total: 1,
              invited: 1,
              alreadyInvited: 0,
              alreadyMember: 0,
              failed: 0,
            },
            rows: [
              {
                line: 2,
                email: 'ada@x.com',
                outcome: { status: 'invited', code: 'inv-1.secret' },
              },
            ],
          },
        },
        'POST',
      ],
    ]);
    renderPage();

    await screen.findByText('Import from a file');
    chooseFile('email\nada@x.com\n');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check the file' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Invite 1 person/ }),
    );

    expect(await screen.findByText('inv-1.secret')).toBeTruthy();
    // Held in component state and nowhere else: no endpoint can return it a
    // second time, so the screen has to say so.
    expect(screen.getByText(/only time they\s+exist/)).toBeTruthy();
  });

  it('renders a refused FILE as the server worded it', async () => {
    mockFetch([
      ...baseRoutes(IMPORTER_SESSION),
      [
        /\/people\/import\/preview$/,
        {
          status: 400,
          body: { message: 'the import file was refused: unknown_columns' },
        },
        'POST',
      ],
    ]);
    renderPage();

    await screen.findByText('Import from a file');
    chooseFile('email,rol\nada@x.com,agent\n');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check the file' }),
    );

    // A file-level refusal needs the FILE changed, so the message that names
    // the reason is the useful thing to show.
    await waitFor(() =>
      expect(screen.getByText(/unknown_columns/)).toBeTruthy(),
    );
  });

  it('lists the failed rows with their line numbers', async () => {
    mockFetch([
      ...baseRoutes(IMPORTER_SESSION),
      [
        /\/people\/import\/preview$/,
        {
          status: 200,
          body: {
            summary: {
              dryRun: true,
              total: 1,
              invited: 0,
              alreadyInvited: 0,
              alreadyMember: 0,
              failed: 1,
            },
            rows: [
              {
                line: 4,
                email: 'ada@x.com',
                outcome: {
                  status: 'failed',
                  reason: { code: 'branch_unknown', value: 'Stroe 12' },
                },
              },
            ],
          },
        },
        'POST',
      ],
    ]);
    renderPage();

    await screen.findByText('Import from a file');
    chooseFile('email,branch\nada@x.com,Stroe 12\n');
    fireEvent.click(
      await screen.findByRole('button', { name: 'Check the file' }),
    );

    // The line number is what an administrator uses to find the row in their
    // editor, and the value is quoted back so they can see the typo.
    expect(await screen.findByText(/Line 4/)).toBeTruthy();
    expect(screen.getByText(/Stroe 12/)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Download the rows that failed' }),
    ).toBeTruthy();
  });
});

describe('the error report', () => {
  const rows: ImportRowResult[] = [
    { line: 2, email: 'ok@x.com', outcome: { status: 'invited', code: 'c' } },
    {
      line: 3,
      email: 'bad@x.com',
      outcome: {
        status: 'failed',
        reason: {
          code: 'department_wrong_branch',
          value: 'Checkout',
          branch: 'Store 12',
        },
      },
    },
  ];

  it('contains only the rows that failed', () => {
    const report = buildErrorReport(rows);

    expect(report).toContain('bad@x.com');
    expect(report).not.toContain('ok@x.com');
    // And therefore never a code: a failed row has none.
    expect(report).not.toContain(',c');
  });

  it('quotes fields so a comma in a message cannot break the file', () => {
    const report = buildErrorReport(rows);
    const [header, row] = report.trim().split('\n');

    expect(header).toBe('line,email,error');
    expect(row.startsWith('"3","bad@x.com","')).toBe(true);
  });

  it('says which mistake it was, in words an administrator can act on', () => {
    expect(
      importFailureMessage({
        code: 'department_without_branch',
        value: 'Electronics',
      }),
    ).toContain('needs a branch');
    expect(
      importFailureMessage({ code: 'role_not_grantable', value: 'owner' }),
    ).toContain('cannot grant');
    expect(
      importFailureMessage({
        code: 'duplicate_in_file',
        value: 'ada@x.com',
        firstSeenOnLine: 2,
      }),
    ).toContain('line 2');
  });
});
