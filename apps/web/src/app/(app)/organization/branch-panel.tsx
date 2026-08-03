'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../../components/ui/button';
import { FormError, Input } from '../../../components/ui/field';
import {
  createDepartment,
  createStation,
  getBranchStructure,
  updateDepartment,
  updateStation,
  type Branch,
  type BranchStructure,
  type StructureStatus,
} from '../../../lib/organization';
import styles from './page.module.css';

/**
 * One string rather than a fragment of two: an archived marker rendered as a
 * sibling text node splits the label, and a reader (screen or test) then has
 * to reassemble it.
 */
function withArchived(label: string, status: StructureStatus): string {
  return status === 'archived' ? `${label} (archived)` : label;
}

export interface BranchPanelProps {
  accessToken: string;
  branch: Branch;
  canUpdate: boolean;
  onChanged: (message: string) => void;
}

/**
 * What is inside one branch: its departments and its service points.
 *
 * Both live here rather than on screens of their own because neither means
 * anything apart from the branch — a department list without it is a list of
 * names. Archived rows stay visible, which is what makes un-archiving
 * possible at all.
 */
export function BranchPanel({
  accessToken,
  branch,
  canUpdate,
  onChanged,
}: BranchPanelProps) {
  const [structure, setStructure] = useState<BranchStructure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [departmentName, setDepartmentName] = useState('');
  const [stationCode, setStationCode] = useState('');
  const [stationName, setStationName] = useState('');
  const [busy, setBusy] = useState(false);

  const { branchId } = branch;

  const load = useCallback(async () => {
    try {
      setStructure(await getBranchStructure(accessToken, branchId));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Load failed');
    }
  }, [accessToken, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  function addDepartment(event: FormEvent) {
    event.preventDefault();
    if (!departmentName.trim()) {
      return;
    }
    void run(async () => {
      await createDepartment(accessToken, branchId, departmentName.trim());
      setDepartmentName('');
      onChanged(`Department added to ${branch.name}.`);
    });
  }

  function addStation(event: FormEvent) {
    event.preventDefault();
    if (!stationCode.trim() || !stationName.trim()) {
      return;
    }
    void run(async () => {
      await createStation(accessToken, branchId, {
        code: stationCode.trim(),
        name: stationName.trim(),
      });
      setStationCode('');
      setStationName('');
      onChanged(`Service point added to ${branch.name}.`);
    });
  }

  return (
    <div className={styles.panel}>
      {branch.status === 'archived' ? (
        // Archiving a branch does not cascade (Sprint 9.11, D4) — its
        // contents are still here, they are simply unreachable through it.
        <p className={styles.hint}>
          This branch is archived, so nothing inside it can be used for new
          tickets. Its departments and service points are kept as they were, and
          reopening the branch restores all of it.
        </p>
      ) : null}

      <section aria-label="Departments" className={styles.panelSection}>
        <h3 className={styles.panelTitle}>Departments</h3>
        {structure === null ? (
          <p className={styles.empty}>Loading…</p>
        ) : structure.departments.length === 0 ? (
          <p className={styles.empty}>None yet.</p>
        ) : (
          <ul className={styles.itemList}>
            {structure.departments.map((department) => (
              <li key={department.departmentId} className={styles.item}>
                <span>{withArchived(department.name, department.status)}</span>
                {canUpdate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        await updateDepartment(
                          accessToken,
                          department.departmentId,
                          {
                            status:
                              department.status === 'archived'
                                ? 'active'
                                : 'archived',
                          },
                        );
                        onChanged(`${department.name} updated.`);
                      })
                    }
                  >
                    {department.status === 'archived' ? 'Restore' : 'Archive'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canUpdate ? (
          <form
            className={styles.inlineForm}
            aria-label={`add department to ${branch.name}`}
            onSubmit={addDepartment}
          >
            <Input
              id={`department-${branchId}`}
              label="New department"
              value={departmentName}
              onChange={(event) => setDepartmentName(event.target.value)}
              placeholder="Electronics"
            />
            <Button type="submit" size="sm" loading={busy}>
              Add
            </Button>
          </form>
        ) : null}
      </section>

      <section aria-label="Service points" className={styles.panelSection}>
        <h3 className={styles.panelTitle}>Service points</h3>
        {/* ADR 0016: a station is a place a request can name, never something
            that authenticates. Saying so here keeps the interface from
            implying it is an account. */}
        <p className={styles.hint}>
          A service point is a place — the till, not the cashier. It has no
          login of its own; people sign in as themselves and say where they are.
        </p>
        {structure === null ? (
          <p className={styles.empty}>Loading…</p>
        ) : structure.stations.length === 0 ? (
          <p className={styles.empty}>None yet.</p>
        ) : (
          <ul className={styles.itemList}>
            {structure.stations.map((station) => (
              <li key={station.stationId} className={styles.item}>
                <span>
                  {withArchived(
                    `${station.name} · ${station.code}`,
                    station.status,
                  )}
                </span>
                {canUpdate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(async () => {
                        await updateStation(accessToken, station.stationId, {
                          status:
                            station.status === 'archived'
                              ? 'active'
                              : 'archived',
                        });
                        onChanged(`${station.name} updated.`);
                      })
                    }
                  >
                    {station.status === 'archived' ? 'Restore' : 'Archive'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canUpdate ? (
          <form
            className={styles.inlineForm}
            aria-label={`add service point to ${branch.name}`}
            onSubmit={addStation}
          >
            <Input
              id={`station-code-${branchId}`}
              label="Code"
              value={stationCode}
              onChange={(event) => setStationCode(event.target.value)}
              placeholder="cashier-2"
            />
            <Input
              id={`station-name-${branchId}`}
              label="Name"
              value={stationName}
              onChange={(event) => setStationName(event.target.value)}
              placeholder="Cashier station 2"
            />
            <Button type="submit" size="sm" loading={busy}>
              Add
            </Button>
          </form>
        ) : null}
      </section>

      {error ? <FormError>{error}</FormError> : null}
    </div>
  );
}
