/**
 * Date helpers for the UI. Every formatter guards against missing or
 * invalid input by returning an empty string — callers hide the element.
 */

const DIVISIONS: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> =
  [
    { amount: 60, unit: 'seconds' },
    { amount: 60, unit: 'minutes' },
    { amount: 24, unit: 'hours' },
    { amount: 7, unit: 'days' },
    { amount: 4.34524, unit: 'weeks' },
    { amount: 12, unit: 'months' },
    { amount: Number.POSITIVE_INFINITY, unit: 'years' },
  ];

const relativeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
});

/** "3 minutes ago", "yesterday", … relative to now. */
export function relativeTime(iso: string | undefined): string {
  if (!iso) {
    return '';
  }
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return '';
  }
  let duration = (then - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return relativeFormatter.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return '';
}

const dateTimeFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** "Jul 28, 2026, 10:42 AM" — for history timestamps. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return dateTimeFormatter.format(date);
}
