/**
 * The machine remembers the PLACE, never the identity (ADR 0016: a station
 * is context, not a principal). This module stores branch/station ids and
 * their labels — labels so the prefill can render without a fetch — and
 * nothing else: no tokens, no user ids, no credentials ever belong here.
 * The refresh credential stays in the httpOnly cookie, which in shared mode
 * is session-scoped on purpose.
 *
 * The ids are advisory until submitted: the server re-validates them
 * against its projection, and a stale or foreign remembered id is refused
 * there — the caller of `load` must treat the value as a suggestion.
 */

const STORAGE_KEY = 'helpdesk.station-context';

export interface StationContext {
  branchId: string;
  branchLabel: string;
  stationId?: string;
  stationLabel?: string;
}

export function loadStationContext(): StationContext | null {
  // localStorage can be absent (SSR) or throw (privacy modes); a machine
  // that cannot remember simply behaves like a fresh one.
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StationContext>;
    if (
      typeof parsed.branchId !== 'string' ||
      typeof parsed.branchLabel !== 'string'
    ) {
      return null;
    }
    return {
      branchId: parsed.branchId,
      branchLabel: parsed.branchLabel,
      ...(typeof parsed.stationId === 'string' &&
      typeof parsed.stationLabel === 'string'
        ? { stationId: parsed.stationId, stationLabel: parsed.stationLabel }
        : {}),
    };
  } catch {
    return null;
  }
}

export function saveStationContext(context: StationContext): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(context));
  } catch {
    // Best effort: a till that cannot persist just asks again next time.
  }
}

export function clearStationContext(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same best-effort stance as save.
  }
}
