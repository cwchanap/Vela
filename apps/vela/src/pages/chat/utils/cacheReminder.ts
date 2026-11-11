import { LLM_PROVIDER_REGISTRY, type LlmProvider } from '@vela/common';

/**
 * Display-only grace period after the cache TTL: the elapsed warning shows
 * from TTL through TTL + MAX_ELAPSED_WINDOW_SECONDS, then the chip hides.
 */
export const MAX_ELAPSED_WINDOW_SECONDS = 300;

export type CacheReminderState = 'hidden' | 'warm' | 'warning' | 'elapsed';

export interface CacheReminderResult {
  state: CacheReminderState;
  /** Remaining seconds clamped to [0, TTL]; 0 when hidden. */
  remainingSeconds: number;
  /** Ready-to-render copy; '' when hidden. */
  label: string;
}

const formatRemaining = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Estimated prompt-cache reuse window from a positive-evidence request-start
 * timestamp. Windows come only from LLM_PROVIDER_REGISTRY.cacheTtlSeconds and
 * are approximate, not guaranteed eviction or charge estimates.
 */
export const cacheReminder = (
  provider: LlmProvider | null,
  cacheStartedAt: number | null,
  now: number,
): CacheReminderResult => {
  const hidden: CacheReminderResult = { state: 'hidden', remainingSeconds: 0, label: '' };
  if (!provider || cacheStartedAt === null) return hidden;
  const ttlSeconds = LLM_PROVIDER_REGISTRY[provider].cacheTtlSeconds;
  if (ttlSeconds === null) return hidden;

  const elapsedSeconds = Math.floor((now - cacheStartedAt) / 1000);
  if (elapsedSeconds > ttlSeconds + MAX_ELAPSED_WINDOW_SECONDS) return hidden;

  const remainingSeconds = Math.min(
    Math.max(ttlSeconds - Math.max(elapsedSeconds, 0), 0),
    ttlSeconds,
  );
  if (remainingSeconds >= 60) {
    return {
      state: 'warm',
      remainingSeconds,
      label: `Cache likely warm · ${formatRemaining(remainingSeconds)} left`,
    };
  }
  if (remainingSeconds >= 1) {
    return {
      state: 'warning',
      remainingSeconds,
      label: `Cache window · ${formatRemaining(remainingSeconds)} left`,
    };
  }
  return {
    state: 'elapsed',
    remainingSeconds: 0,
    label: 'Cache window elapsed · next message may miss cache',
  };
};
