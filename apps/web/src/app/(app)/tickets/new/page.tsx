'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../../../../components/auth-context';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { EmptyState } from '../../../../components/ui/empty-state';
import {
  FormError,
  Input,
  Select,
  Textarea,
} from '../../../../components/ui/field';
import { LockIcon } from '../../../../components/ui/icons';
import { PriorityDot } from '../../../../components/ui/status';
import {
  clearStationContext,
  loadStationContext,
  saveStationContext,
} from '../../../../lib/station-context';
import {
  createTicket,
  listBranches,
  listStations,
  TicketsApiError,
  type BranchOption,
  type StationOption,
  type TicketPriority,
} from '../../../../lib/tickets';
import styles from './page.module.css';

const PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'urgent'];

export default function NewTicketPage() {
  const { status, session } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  // Location context. An organization with no branches gets exactly the
  // old form: `branches` stays empty and nothing below renders.
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [stations, setStations] = useState<StationOption[]>([]);
  const [branchId, setBranchId] = useState('');
  const [stationId, setStationId] = useState('');
  const [remembered, setRemembered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    listBranches(session.accessToken)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setBranches(loaded);
        // Prefill from what this machine remembers — but only if the
        // remembered branch still exists here: a stale or foreign id is
        // dropped (and forgotten) rather than submitted to certain refusal.
        const stored = loadStationContext();
        if (stored && loaded.some((branch) => branch.id === stored.branchId)) {
          setBranchId(stored.branchId);
          if (stored.stationId) {
            setStationId(stored.stationId);
          }
          setRemembered(true);
        } else if (stored) {
          clearStationContext();
        }
      })
      .catch(() => {
        // The picker is a convenience; a failed load leaves the plain form.
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session || !branchId) {
      setStations([]);
      return;
    }
    let cancelled = false;
    listStations(session.accessToken, branchId)
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        setStations(loaded);
        // A remembered station that no longer exists under the branch is
        // dropped silently; the branch itself already validated.
        setStationId((current) =>
          current && !loaded.some((station) => station.id === current)
            ? ''
            : current,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setStations([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session, branchId]);

  if (status === 'anonymous') {
    return (
      <EmptyState
        icon={<LockIcon size={22} />}
        title="You are not signed in"
        hint="Sign in to open a new support ticket."
        action={<ButtonLink href="/login">Sign in</ButtonLink>}
      />
    );
  }

  function forgetLocation() {
    clearStationContext();
    setBranchId('');
    setStationId('');
    setRemembered(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // aria-disabled submit stays focusable — guard against re-entry.
    if (!session || submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const ticket = await createTicket(session.accessToken, {
        title,
        description,
        priority,
        ...(branchId ? { branchId } : {}),
        ...(branchId && stationId ? { stationId } : {}),
      });
      if (branchId) {
        const branch = branches.find((option) => option.id === branchId);
        const station = stations.find((option) => option.id === stationId);
        // Remember the PLACE for the next request from this machine —
        // ids and labels only, never identity (ADR 0016).
        saveStationContext({
          branchId,
          branchLabel: branch ? `${branch.name} (${branch.code})` : branchId,
          ...(station
            ? {
                stationId: station.id,
                stationLabel: `${station.name} (${station.code})`,
              }
            : {}),
        });
      }
      router.push(`/tickets/${ticket.id}`);
    } catch (submitError) {
      // A refused location means the remembered ids went stale (archived,
      // or another organization's leftovers): forget them so the next
      // attempt starts clean.
      if (
        submitError instanceof TicketsApiError &&
        submitError.status === 422
      ) {
        forgetLocation();
      }
      setError(
        submitError instanceof Error ? submitError.message : 'Creation failed',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>New ticket</h1>
      <Card className={styles.card}>
        <form
          onSubmit={handleSubmit}
          aria-label="new ticket form"
          className={styles.form}
        >
          <Input
            id="title"
            label="Title"
            required
            minLength={3}
            maxLength={200}
            placeholder="Summarize the problem"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <Textarea
            id="description"
            label="Description"
            required
            maxLength={5000}
            placeholder="What happened? What did you expect instead?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />

          {branches.length > 0 ? (
            <div className={styles.locationGroup}>
              <Select
                id="branch"
                label="Location"
                value={branchId}
                onChange={(event) => {
                  setBranchId(event.target.value);
                  setStationId('');
                  setRemembered(false);
                }}
              >
                <option value="">No specific location</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </Select>

              {branchId && stations.length > 0 ? (
                <Select
                  id="station"
                  label="Workstation"
                  value={stationId}
                  onChange={(event) => setStationId(event.target.value)}
                >
                  <option value="">No specific workstation</option>
                  {stations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name} ({station.code})
                    </option>
                  ))}
                </Select>
              ) : null}

              {remembered ? (
                <p className={styles.rememberedNote}>
                  This computer remembered its location.{' '}
                  <button
                    type="button"
                    className={styles.forgetButton}
                    onClick={forgetLocation}
                  >
                    Forget it
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}

          <fieldset className={styles.priorityGroup}>
            <legend className={styles.legend}>Priority</legend>
            <div className={styles.priorityOptions}>
              {PRIORITIES.map((option) => (
                <label
                  key={option}
                  className={
                    priority === option
                      ? `${styles.priorityPill} ${styles.priorityActive}`
                      : styles.priorityPill
                  }
                >
                  <input
                    type="radio"
                    name="priority"
                    value={option}
                    checked={priority === option}
                    onChange={() => setPriority(option)}
                    className="sr-only"
                  />
                  <PriorityDot priority={option} />
                </label>
              ))}
            </div>
          </fieldset>

          {error ? <FormError>{error}</FormError> : null}

          <Button type="submit" loading={submitting} className={styles.submit}>
            Create ticket
          </Button>
        </form>
      </Card>
    </div>
  );
}
