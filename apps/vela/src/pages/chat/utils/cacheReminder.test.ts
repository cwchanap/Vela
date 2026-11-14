import { describe, it, expect } from 'vitest';
import {
  cacheReminder,
  MAX_ELAPSED_WINDOW_SECONDS,
  MAX_FUTURE_SKEW_SECONDS,
} from './cacheReminder';

describe('cacheReminder', () => {
  describe('hidden cases', () => {
    it('hides when no cache evidence timestamp exists', () => {
      expect(cacheReminder('anthropic', null, Date.now())).toEqual({
        state: 'hidden',
        remainingSeconds: 0,
        label: '',
      });
    });

    it('hides for providers without a prompt-cache TTL', () => {
      const start = 1_700_000_000_000;
      expect(cacheReminder('google', start, start + 1000).state).toBe('hidden');
      expect(cacheReminder('openrouter', start, start + 1000).state).toBe('hidden');
    });

    it('hides once the elapsed grace window is exceeded', () => {
      const start = 1_700_000_000_000;
      const ttl = 300;
      const grace = MAX_ELAPSED_WINDOW_SECONDS;
      expect(cacheReminder('anthropic', start, start + (ttl + grace + 1) * 1000).state).toBe(
        'hidden',
      );
    });

    it('hides 1 ms past the TTL + 300 boundary, before rounding for display', () => {
      const start = 1_700_000_000_000;
      expect(
        cacheReminder('anthropic', start, start + (300 + MAX_ELAPSED_WINDOW_SECONDS) * 1000 + 1)
          .state,
      ).toBe('hidden');
      expect(
        cacheReminder('openai', start, start + (1800 + MAX_ELAPSED_WINDOW_SECONDS) * 1000 + 1)
          .state,
      ).toBe('hidden');
    });

    it('hides a historical thread reloaded long after its persisted timestamp', () => {
      const start = 1_700_000_000_000;
      expect(cacheReminder('openai', start, start + 30 * 60 * 1000 + 301 * 1000).state).toBe(
        'hidden',
      );
    });

    it('hides when cacheStartedAt is non-finite', () => {
      const now = 1_700_000_000_000;
      expect(cacheReminder('anthropic', Number.NaN, now).state).toBe('hidden');
      expect(cacheReminder('anthropic', Number.POSITIVE_INFINITY, now).state).toBe('hidden');
    });

    it('hides when cacheStartedAt is beyond the allowed future skew', () => {
      const now = 1_700_000_000_000;
      const future = now + (MAX_FUTURE_SKEW_SECONDS + 1) * 1000;
      expect(cacheReminder('anthropic', future, now)).toEqual({
        state: 'hidden',
        remainingSeconds: 0,
        label: '',
      });
    });
  });

  describe('warm state', () => {
    it('shows 5:00 warm at the request-start timestamp for Anthropic', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('anthropic', start, start);
      expect(result.state).toBe('warm');
      expect(result.remainingSeconds).toBe(300);
      expect(result.label).toBe('Cache likely warm · 5:00 left');
    });

    it('stays warm with exactly 60 seconds remaining', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('anthropic', start, start + 240 * 1000);
      expect(result.state).toBe('warm');
      expect(result.remainingSeconds).toBe(60);
      expect(result.label).toBe('Cache likely warm · 1:00 left');
    });

    it('shows the full window for a future-skewed client clock', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('anthropic', start, start - 5000);
      expect(result.state).toBe('warm');
      expect(result.remainingSeconds).toBe(300);
      expect(result.label).toBe('Cache likely warm · 5:00 left');
    });

    it('formats the 30-minute OpenAI window as 30:00', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('openai', start, start);
      expect(result.state).toBe('warm');
      expect(result.remainingSeconds).toBe(1800);
      expect(result.label).toBe('Cache likely warm · 30:00 left');
    });
  });

  describe('warning state', () => {
    it('warns with 59 seconds remaining', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('anthropic', start, start + 241 * 1000);
      expect(result.state).toBe('warning');
      expect(result.remainingSeconds).toBe(59);
      expect(result.label).toBe('Cache window · 0:59 left');
    });

    it('warns at 1 second remaining', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('anthropic', start, start + 299 * 1000);
      expect(result.state).toBe('warning');
      expect(result.remainingSeconds).toBe(1);
      expect(result.label).toBe('Cache window · 0:01 left');
    });
  });

  describe('elapsed state', () => {
    it('shows elapsed with 0 seconds remaining', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('anthropic', start, start + 300 * 1000);
      expect(result.state).toBe('elapsed');
      expect(result.remainingSeconds).toBe(0);
      expect(result.label).toBe('Cache window elapsed · next message may miss cache');
    });

    it('still shows elapsed exactly at TTL + 300 seconds', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('anthropic', start, start + 600 * 1000);
      expect(result.state).toBe('elapsed');
    });

    it('keeps the stored timestamp in the result window for OpenAI', () => {
      const start = 1_700_000_000_000;
      const result = cacheReminder('openai', start, start + 1800 * 1000 + 300 * 1000);
      expect(result.state).toBe('elapsed');
    });
  });
});
