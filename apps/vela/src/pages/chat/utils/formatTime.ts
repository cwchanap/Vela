const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = timestamp - now;
  const absDiff = Math.abs(diff);

  if (absDiff < MINUTE_MS) {
    return 'just now';
  }
  if (absDiff < HOUR_MS) {
    return relativeTimeFormatter.format(Math.trunc(diff / MINUTE_MS), 'minute');
  }
  if (absDiff < DAY_MS) {
    return relativeTimeFormatter.format(Math.trunc(diff / HOUR_MS), 'hour');
  }
  return relativeTimeFormatter.format(Math.trunc(diff / DAY_MS), 'day');
}
