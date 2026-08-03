import {
  buildImportTemplate,
  checkImportRows,
  parseImportFile,
  MAX_IMPORT_CHARACTERS,
  MAX_IMPORT_ROWS,
  type ParsedImportRow,
} from './people-import';

function parsed(csv: string) {
  const result = parseImportFile(csv);
  if (!result.ok) {
    throw new Error(`expected a parsed file, got ${result.rejection.reason}`);
  }
  return result.file.rows;
}

function rejection(csv: string) {
  const result = parseImportFile(csv);
  if (result.ok) {
    throw new Error('expected the file to be refused');
  }
  return result.rejection;
}

describe('parseImportFile', () => {
  it('reads the four columns and numbers rows as the spreadsheet does', () => {
    const rows = parsed(
      'email,role,branch,department\nada@x.com,agent,Store 12,Electronics\n',
    );

    expect(rows).toEqual([
      {
        // Line 2, because the header is line 1 — the number an administrator
        // sees in their editor when told which row to fix.
        line: 2,
        email: 'ada@x.com',
        role: 'agent',
        branch: 'Store 12',
        department: 'Electronics',
      },
    ]);
  });

  it('survives what a spreadsheet actually exports', () => {
    // A byte-order mark (Excel's UTF-8), CRLF endings, a quoted field holding
    // a comma, a doubled quote, and the trailing newline every editor adds.
    const csv =
      // Written as an escape: the character itself is invisible in an editor,
      // which is exactly how a test for it gets silently deleted.
      '\uFEFF' +
      'email,role,branch\r\n' +
      'ada@x.com,agent,"Store 12, North"\r\n' +
      'alan@x.com,requester,"He said ""hi"""\r\n' +
      '\r\n';
    const rows = parsed(csv);

    expect(rows.map((row) => row.branch)).toEqual([
      'Store 12, North',
      'He said "hi"',
    ]);
    // The blank trailing line is skipped rather than reported: an error about
    // it would fire on essentially every import.
    expect(rows).toHaveLength(2);
  });

  it('treats blank cells as absent and trims the rest', () => {
    const rows = parsed('email,role,branch,department\n  ada@x.com , , , \n');

    expect(rows[0]).toEqual({
      line: 2,
      email: 'ada@x.com',
      role: null,
      branch: null,
      department: null,
    });
  });

  it('accepts columns in any order and a file with only email', () => {
    const rows = parsed('department,email\nElectronics,ada@x.com\n');
    expect(rows[0]).toEqual(
      expect.objectContaining({
        email: 'ada@x.com',
        department: 'Electronics',
      }),
    );

    const minimal = parsed('email\nada@x.com\n');
    expect(minimal[0]).toEqual(
      expect.objectContaining({ email: 'ada@x.com', role: null }),
    );
  });

  it('refuses the WHOLE file for an unknown column', () => {
    // Not "ignore the column": a misspelled header that gets dropped silently
    // gives every row the default for something the administrator set.
    expect(rejection('email,rol\nada@x.com,agent\n')).toEqual({
      reason: 'unknown_columns',
      columns: ['rol'],
    });
  });

  it('refuses a repeated column rather than picking one', () => {
    expect(rejection('email,role,role\na@x.com,agent,owner\n')).toEqual({
      reason: 'duplicate_columns',
      columns: ['role'],
    });
  });

  it('refuses a file with no email column and an empty one', () => {
    expect(rejection('role,branch\nagent,Store 12\n')).toEqual({
      reason: 'missing_email_column',
    });
    expect(rejection('   \n\n')).toEqual({ reason: 'empty' });
    expect(rejection('')).toEqual({ reason: 'empty' });
  });

  it('refuses more rows than it will import, and a file too large to be one', () => {
    const many =
      'email\n' +
      Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `p${i}@x.com`).join(
        '\n',
      );
    expect(rejection(many)).toEqual({
      reason: 'too_many_rows',
      rows: MAX_IMPORT_ROWS + 1,
    });

    const huge = 'email\n' + 'a'.repeat(MAX_IMPORT_CHARACTERS + 1);
    expect(rejection(huge).reason).toBe('too_large');
  });

  it('accepts exactly the row cap', () => {
    const atCap =
      'email\n' +
      Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => `p${i}@x.com`).join(
        '\n',
      );
    expect(parsed(atCap)).toHaveLength(MAX_IMPORT_ROWS);
  });
});

describe('checkImportRows', () => {
  function row(overrides: Partial<ParsedImportRow>): ParsedImportRow {
    return {
      line: 2,
      email: 'ada@x.com',
      role: null,
      branch: null,
      department: null,
      ...overrides,
    };
  }

  it('normalizes the address it will compare and write', () => {
    const [checked] = checkImportRows([row({ email: '  Ada@Example.COM ' })]);

    expect(checked.normalizedEmail).toBe('ada@example.com');
    expect(checked.problem).toBeNull();
  });

  it('finds a duplicate that differs only by case, and names the first line', () => {
    const checked = checkImportRows([
      row({ line: 2, email: 'ada@example.com' }),
      row({ line: 3, email: 'ALAN@example.com' }),
      row({ line: 4, email: 'Ada@Example.com' }),
    ]);

    expect(checked[0].problem).toBeNull();
    expect(checked[1].problem).toBeNull();
    // The second occurrence is the problem, and it points at the first so the
    // administrator knows which line to delete.
    expect(checked[2].problem).toEqual({
      code: 'duplicate_in_file',
      value: 'ada@example.com',
      firstSeenOnLine: 2,
    });
  });

  it('reports a missing address separately from a malformed one', () => {
    const checked = checkImportRows([
      row({ line: 2, email: '   ' }),
      row({ line: 3, email: 'not-an-address' }),
      row({ line: 4, email: 'two@@at.com' }),
      row({ line: 5, email: 'no@tld' }),
    ]);

    expect(checked.map((entry) => entry.problem?.code)).toEqual([
      'email_missing',
      'email_malformed',
      'email_malformed',
      'email_malformed',
    ]);
  });

  it('accepts the shapes real addresses take', () => {
    const checked = checkImportRows(
      [
        'ada.lovelace@example.com',
        'ada+team@example.co.uk',
        "o'hara@example.com",
        'ada_lovelace@sub.example.com',
      ].map((email, index) => row({ line: index + 2, email })),
    );

    expect(checked.every((entry) => entry.problem === null)).toBe(true);
  });
});

describe('buildImportTemplate', () => {
  it('names the schema and offers only roles the caller may grant', () => {
    const template = buildImportTemplate(['organization_admin', 'agent']);
    const [header, ...examples] = template.trim().split('\n');

    expect(header).toBe('email,role,branch,department');
    // The stable keys, not display labels: labels are localizable (9.14 D7),
    // so a file written against them would break when they are translated.
    expect(examples.join('\n')).toContain('agent');
    expect(examples.join('\n')).toContain('organization_admin');
    expect(template).not.toContain('owner');
  });

  it('round-trips through the parser it was written for', () => {
    // The strongest thing to assert about a template: the product can read
    // what the product hands out.
    const template = buildImportTemplate(['agent', 'requester']);
    const rows = parsed(template);

    expect(rows).toHaveLength(2);
    expect(rows.every((entry) => entry.email.includes('@'))).toBe(true);
    expect(checkImportRows(rows).every((entry) => entry.problem === null)).toBe(
      true,
    );
  });
});
