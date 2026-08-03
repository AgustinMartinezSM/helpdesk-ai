import { normalizeInviteeEmail } from './invitation';

/**
 * Reading a spreadsheet an administrator filled in (Sprint 9.15).
 *
 * Everything here is pure. Parsing and per-row shape validation have no
 * business touching a repository, and keeping them separable is what lets the
 * awkward cases — a byte-order mark, CRLF, a quoted comma, a blank line at the
 * end that every editor adds — be tested as data rather than through HTTP.
 *
 * Resolution against real branches, departments and memberships happens in the
 * use case, because only it can ask the database. This file decides what the
 * file SAYS; the use case decides whether the organization agrees.
 */

/** Every column the product understands. An unknown one refuses the file. */
export const IMPORT_COLUMNS = [
  'email',
  'role',
  'branch',
  'department',
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/**
 * Caps, enforced before anything is parsed.
 *
 * 500 rows is the same ceiling the team-member editor uses, and it is a
 * product decision rather than a technical limit: an import bigger than this
 * wants a queue and a progress screen, which is a different sprint. The
 * character cap keeps the JSON body inside the default limit — the file
 * travels as text in a field (D3), not as multipart.
 */
export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_CHARACTERS = 64_000;

/** Why a whole file was refused before any row was considered. */
export type ImportFileRejection =
  | { reason: 'empty' }
  | { reason: 'too_large'; characters: number }
  | { reason: 'too_many_rows'; rows: number }
  | { reason: 'missing_email_column' }
  | { reason: 'unknown_columns'; columns: string[] }
  | { reason: 'duplicate_columns'; columns: string[] };

/** One row as the file states it, before the organization has an opinion. */
export interface ParsedImportRow {
  /** 1-based, counting the header as row 1, so it matches the spreadsheet. */
  readonly line: number;
  readonly email: string;
  readonly role: string | null;
  readonly branch: string | null;
  readonly department: string | null;
}

export interface ParsedImportFile {
  readonly rows: ParsedImportRow[];
}

export type ParseImportFileResult =
  | { ok: true; file: ParsedImportFile }
  | { ok: false; rejection: ImportFileRejection };

/**
 * Splits one CSV line, honouring double-quoted fields.
 *
 * Written rather than taken from a library on purpose: the dependency would
 * arrive with an encoding-detection and streaming surface this never uses, and
 * the format accepted here is deliberately the narrow one — RFC 4180 quoting,
 * a doubled `""` for a literal quote, and nothing else. A file that needs more
 * than this is a file that should have been exported differently.
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

/** Empty string for a blank cell, so callers never see undefined. */
function cell(fields: string[], index: number): string {
  return (fields[index] ?? '').trim();
}

/** Blank once trimmed reads as absent, which is what a spreadsheet means. */
function optional(value: string): string | null {
  return value.length > 0 ? value : null;
}

export function parseImportFile(csv: string): ParseImportFileResult {
  if (csv.length > MAX_IMPORT_CHARACTERS) {
    return {
      ok: false,
      rejection: { reason: 'too_large', characters: csv.length },
    };
  }

  // A byte-order mark is what Excel writes when it saves UTF-8, and stripping
  // it is not cosmetic: left in place it makes the first header parse as
  // U+FEFF + "email", so the file is refused for an unknown column nobody can
  // see. Written as an escape rather than the character itself, which is
  // invisible in an editor and flagged as irregular whitespace by the linter.
  const text = csv.replace(/^\uFEFF/, '');
  const lines = text.split(/\r\n|\n|\r/);

  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex < 0) {
    return { ok: false, rejection: { reason: 'empty' } };
  }

  const headers = splitCsvLine(lines[headerIndex]).map((header) =>
    header.trim().toLowerCase(),
  );

  const duplicates = headers.filter(
    (header, index) => header.length > 0 && headers.indexOf(header) !== index,
  );
  if (duplicates.length > 0) {
    return {
      ok: false,
      rejection: {
        reason: 'duplicate_columns',
        columns: [...new Set(duplicates)],
      },
    };
  }

  const unknown = headers.filter(
    (header) =>
      header.length > 0 &&
      !(IMPORT_COLUMNS as readonly string[]).includes(header),
  );
  if (unknown.length > 0) {
    // The whole file, not the column. A header nobody recognises usually means
    // a misspelling, and silently dropping the column it named would give
    // every row the default for something the administrator thought they set.
    return {
      ok: false,
      rejection: { reason: 'unknown_columns', columns: unknown },
    };
  }

  const columnOf = (column: ImportColumn) => headers.indexOf(column);
  const emailAt = columnOf('email');
  if (emailAt < 0) {
    return { ok: false, rejection: { reason: 'missing_email_column' } };
  }
  const roleAt = columnOf('role');
  const branchAt = columnOf('branch');
  const departmentAt = columnOf('department');

  const rows: ParsedImportRow[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    // Blank lines are skipped rather than reported: every editor leaves one at
    // the end, and an error about it would be noise on every single import.
    if (raw.trim().length === 0) {
      continue;
    }
    const fields = splitCsvLine(raw);
    rows.push({
      line: index + 1,
      email: cell(fields, emailAt),
      role: roleAt < 0 ? null : optional(cell(fields, roleAt)),
      branch: branchAt < 0 ? null : optional(cell(fields, branchAt)),
      department:
        departmentAt < 0 ? null : optional(cell(fields, departmentAt)),
    });
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      rejection: { reason: 'too_many_rows', rows: rows.length },
    };
  }

  return { ok: true, file: { rows } };
}

/**
 * Shape rules a row must pass before the organization is consulted at all.
 *
 * Deliberately not a full RFC 5322 address grammar: this checks that the value
 * could be an address and leaves the rest to the fact that the person has to
 * receive a code at it. Over-strict validation here would refuse real
 * addresses, and the cost of a wrong one is a code nobody redeems.
 */
const EMAIL_SHAPE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

export type RowProblem =
  | { code: 'email_missing' }
  | { code: 'email_malformed'; value: string }
  | { code: 'duplicate_in_file'; value: string; firstSeenOnLine: number };

export interface CheckedImportRow extends ParsedImportRow {
  /** Trimmed and lowercased, the form every comparison and write uses. */
  readonly normalizedEmail: string;
  readonly problem: RowProblem | null;
}

/**
 * Normalizes addresses and finds duplicates WITHIN the file.
 *
 * Duplicates are detected on the normalized address, so `Ada@Example.com` and
 * `ada@example.com` are the same person — which is the whole reason
 * normalization happens before the comparison rather than at the write. The
 * first occurrence is kept and later ones are reported against it by line
 * number, because "which of these two did you mean" is a question only the
 * administrator can answer and the answer is usually "delete the second".
 */
export function checkImportRows(
  rows: readonly ParsedImportRow[],
): CheckedImportRow[] {
  const firstSeen = new Map<string, number>();

  return rows.map((row) => {
    const normalizedEmail = normalizeInviteeEmail(row.email);

    if (normalizedEmail.length === 0) {
      return { ...row, normalizedEmail, problem: { code: 'email_missing' } };
    }
    if (!EMAIL_SHAPE.test(normalizedEmail)) {
      return {
        ...row,
        normalizedEmail,
        problem: { code: 'email_malformed', value: row.email.trim() },
      };
    }

    const seenOn = firstSeen.get(normalizedEmail);
    if (seenOn !== undefined) {
      return {
        ...row,
        normalizedEmail,
        problem: {
          code: 'duplicate_in_file',
          value: normalizedEmail,
          firstSeenOnLine: seenOn,
        },
      };
    }
    firstSeen.set(normalizedEmail, row.line);
    return { ...row, normalizedEmail, problem: null };
  });
}

/**
 * The file the product hands out, pre-filled with roles this actor may grant.
 *
 * Generated rather than served as a static asset so it can never offer a
 * template the server would refuse: the argument is the same per-actor list
 * the invite form renders (Sprint 9.14, D6), and the example rows use the
 * STABLE KEYS because display labels are localizable and a file written
 * against them would break when they are translated.
 */
export function buildImportTemplate(
  grantableRoleTemplates: readonly string[],
): string {
  const narrowest =
    grantableRoleTemplates.at(-1) ?? grantableRoleTemplates[0] ?? '';
  const examples = [
    `ada.lovelace@example.com,${narrowest},,`,
    `alan.turing@example.com,${grantableRoleTemplates[0] ?? narrowest},,`,
  ];
  return [IMPORT_COLUMNS.join(','), ...examples].join('\n') + '\n';
}
