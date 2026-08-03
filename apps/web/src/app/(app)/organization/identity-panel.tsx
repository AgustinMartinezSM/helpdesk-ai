'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { FormError, Input } from '../../../components/ui/field';
import type { OrganizationSettings } from '../../../lib/organization';
import { renameOrganization } from '../../../lib/organization';
import styles from './page.module.css';

export interface IdentityPanelProps {
  accessToken: string;
  organization: OrganizationSettings;
  /** Announced on the page's live region, and reloads the settings read. */
  onRenamed: (message: string) => void;
}

/**
 * The organization's display name.
 *
 * The hint says what does NOT change, which is the part somebody would
 * otherwise assume: the slug is what URLs, references and provisioning key on,
 * and it is derived from the name at creation and fixed afterwards (ADR 0024).
 * Saying "the address does not change" is the honest version of a promise the
 * product cannot make in the other direction — and Sprint 10.4 had to take
 * back a comfortable sentence on the neighbouring screen for exactly this
 * reason.
 *
 * Nothing is written until Save. The field is an ordinary controlled input
 * rather than an edit-in-place: a name is not a toggle, and an accidental
 * keystroke should not rename the organization somebody works in.
 */
export function IdentityPanel({
  accessToken,
  organization,
  onRenamed,
}: IdentityPanelProps) {
  const [name, setName] = useState(organization.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const unchanged = trimmed === organization.name;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) {
      return;
    }
    if (trimmed.length < 2) {
      setError('An organization needs a name of at least two characters.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const renamed = await renameOrganization(accessToken, trimmed);
      // The screen is told by the server what the name now is, rather than
      // assuming its own input won: normalisation happens server-side, and
      // showing the value we sent would hide it.
      setName(renamed.name);
      onRenamed(`This organization is called ${renamed.name} now.`);
    } catch (failure) {
      // A 403 lands here when the permission snapshot is stale (ADR 0020).
      setError(
        failure instanceof Error ? failure.message : 'Could not save the name',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className={styles.createCard}>
      <h2 className={styles.sectionTitle}>Name</h2>
      <form
        className={styles.createForm}
        aria-label="organization name form"
        onSubmit={(event) => void submit(event)}
      >
        <Input
          id="organization-display-name"
          label="Organization name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        {error ? <FormError>{error}</FormError> : null}
        <p className={styles.hint}>
          This is the name people see. Its internal key,{' '}
          <code>{organization.slug}</code>, does not change — anything that
          already points at this organization keeps working.
        </p>
        <Button
          type="submit"
          loading={saving}
          disabled={unchanged}
          className={styles.submit}
        >
          Save name
        </Button>
      </form>
    </Card>
  );
}
