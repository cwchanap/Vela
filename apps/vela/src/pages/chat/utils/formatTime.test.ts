import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from './formatTime';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('returns "just now" for a zero time difference', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
  });

  it('returns "just now" for timestamps within the last minute', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - (MINUTE - 1), NOW)).toBe('just now');
  });

  it('returns "just now" for near-future clock skew', () => {
    expect(formatRelativeTime(NOW + 500, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW + 59_999, NOW)).toBe('just now');
  });

  it('formats whole minutes ago', () => {
    expect(formatRelativeTime(NOW - MINUTE, NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(NOW - 30 * MINUTE, NOW)).toBe('30 minutes ago');
    expect(formatRelativeTime(NOW - 59 * MINUTE, NOW)).toBe('59 minutes ago');
  });

  it('formats whole hours ago', () => {
    expect(formatRelativeTime(NOW - HOUR, NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(NOW - 5 * HOUR, NOW)).toBe('5 hours ago');
    expect(formatRelativeTime(NOW - 23 * HOUR, NOW)).toBe('23 hours ago');
  });

  it('formats days ago with auto numeric naming', () => {
    expect(formatRelativeTime(NOW - DAY, NOW)).toBe('yesterday');
    expect(formatRelativeTime(NOW - 2 * DAY, NOW)).toBe('2 days ago');
    expect(formatRelativeTime(NOW - 30 * DAY, NOW)).toBe('30 days ago');
  });

  it('formats far-future skewed timestamps as future intervals', () => {
    expect(formatRelativeTime(NOW + 5 * MINUTE, NOW)).toBe('in 5 minutes');
    expect(formatRelativeTime(NOW + 2 * HOUR, NOW)).toBe('in 2 hours');
    expect(formatRelativeTime(NOW + DAY, NOW)).toBe('tomorrow');
  });
});
