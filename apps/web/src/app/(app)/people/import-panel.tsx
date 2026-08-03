'use client';

import { useState, type ChangeEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { FormError } from '../../../components/ui/field';
import { MailIcon, UploadIcon } from '../../../components/ui/icons';
import {
  applyImport,
  buildErrorReport,
  getImportTemplate,
  importFailureMessage,
  previewImport,
  type ImportResult,
  type ImportRowResult,
} from '../../../lib/people';
import styles from './page.module.css';

export interface ImportPanelProps {
  accessToken: string;
  onImported: (message: string) => void;
}

/** Saves text the browser generated, without a round trip or a stored file. */
function download(filename: string, text: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function failedRows(result: ImportResult): ImportRowResult[] {
  return result.rows.filter((row) => row.outcome.status === 'failed');
}

function issuedCodes(result: ImportResult): ImportRowResult[] {
  return result.rows.filter((row) => row.outcome.status === 'invited');
}

/**
 * Bringing a whole team in from a spreadsheet (Sprint 9.15).
 *
 * The shape of the screen is the safety property: **preview, then apply**.
 * The preview writes nothing, and the apply re-validates from scratch rather
 * than trusting it — so what this shows is a forecast, not a promise, and the
 * copy says which.
 *
 * The one thing an administrator must understand before they start is that
 * this creates ACCESS, not accounts, and that nothing is sent anywhere. Two
 * hundred rows hand back two hundred codes they have to distribute
 * themselves. Saying that after the import would be too late to plan for.
 */
export function ImportPanel({ accessToken, onImported }: ImportPanelProps) {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [applied, setApplied] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      // A refused FILE arrives as a 4xx with the server's message — an unknown
      // column, too many rows. Rendered as it came rather than summarized,
      // because the administrator has to change the file to fix it.
      setError(failure instanceof Error ? failure.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    // Read in the browser and sent as text (D3): no multipart through three
    // processes for a payload this size.
    void file.text().then((text) => {
      setCsv(text);
      setFilename(file.name);
      setPreview(null);
      setApplied(null);
      setError(null);
    });
  }

  const result = applied ?? preview;
  const failures = result ? failedRows(result) : [];

  return (
    <Card className={styles.inviteCard}>
      <h2 className={styles.sectionTitle}>
        <UploadIcon size={17} />
        Import from a file
      </h2>

      {/* Said before they start, not after: this is the same out-of-band
          delivery the single invitation has, multiplied by the row count. */}
      <p className={styles.importNote}>
        <MailIcon size={14} />
        This creates an invitation for each row and sends nothing. You will get
        one code per person to pass on yourself, and you will not be able to see
        them again.
      </p>

      <div className={styles.importActions}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={() =>
            void run(async () => {
              const template = await getImportTemplate(accessToken);
              download(template.filename, template.csv);
              onImported('Template downloaded.');
            })
          }
        >
          Download template
        </Button>
        <label className={styles.fileLabel}>
          <input
            type="file"
            accept=".csv,text/csv"
            className={styles.fileInput}
            onChange={chooseFile}
          />
          <span>{filename ?? 'Choose a CSV file'}</span>
        </label>
      </div>

      <p className={styles.hintText}>
        Columns: <code>email</code>, <code>role</code>, <code>branch</code>,{' '}
        <code>department</code>. Only <code>email</code> is required. A branch
        or department that does not already exist is reported as an error —
        nothing is created from a spelling.
      </p>

      {csv && !applied ? (
        <div className={styles.importActions}>
          <Button
            type="button"
            size="sm"
            loading={busy}
            onClick={() =>
              void run(async () => {
                setPreview(await previewImport(accessToken, csv));
              })
            }
          >
            Check the file
          </Button>
          {preview && preview.summary.invited > 0 ? (
            <Button
              type="button"
              size="sm"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const outcome = await applyImport(accessToken, csv);
                  setApplied(outcome);
                  onImported(
                    `${outcome.summary.invited} invitation(s) created.`,
                  );
                })
              }
            >
              Invite {preview.summary.invited}{' '}
              {preview.summary.invited === 1 ? 'person' : 'people'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? <FormError>{error}</FormError> : null}

      {result ? (
        <div className={styles.importResult} role="status">
          <p className={styles.importSummary}>
            {result.summary.dryRun
              ? `${result.summary.total} row(s) checked: ${result.summary.invited} to invite, ${result.summary.alreadyInvited + result.summary.alreadyMember} already here, ${result.summary.failed} with problems. Nothing has been created yet.`
              : `${result.summary.invited} invited, ${result.summary.alreadyInvited + result.summary.alreadyMember} skipped, ${result.summary.failed} with problems.`}
          </p>

          {failures.length > 0 ? (
            <>
              <ul className={styles.importErrors}>
                {failures.slice(0, 10).map((row) => (
                  <li key={row.line}>
                    <strong>Line {row.line}</strong>
                    {row.email ? ` · ${row.email}` : ''} —{' '}
                    {row.outcome.status === 'failed'
                      ? importFailureMessage(row.outcome.reason)
                      : ''}
                  </li>
                ))}
              </ul>
              {failures.length > 10 ? (
                <p className={styles.hintText}>
                  {failures.length - 10} more in the report.
                </p>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  download(
                    'helpdesk-import-errors.csv',
                    buildErrorReport(result.rows),
                  )
                }
              >
                Download the rows that failed
              </Button>
            </>
          ) : null}

          {applied && issuedCodes(applied).length > 0 ? (
            <div
              className={styles.codePanel}
              role="group"
              aria-label="Invitation codes"
            >
              <p className={styles.codeIntro}>
                One code per person. Copy them now — this is the only time they
                exist.
              </p>
              <ul className={styles.importCodes}>
                {issuedCodes(applied).map((row) => (
                  <li key={row.line}>
                    <span className={styles.meta}>{row.email}</span>
                    <code className={styles.code}>
                      {row.outcome.status === 'invited' ? row.outcome.code : ''}
                    </code>
                  </li>
                ))}
              </ul>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  download(
                    'helpdesk-invitation-codes.csv',
                    'email,code\n' +
                      issuedCodes(applied)
                        .map((row) =>
                          row.outcome.status === 'invited'
                            ? `${row.email},${row.outcome.code}`
                            : '',
                        )
                        .join('\n') +
                      '\n',
                  )
                }
              >
                Download the codes
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
