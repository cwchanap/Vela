import type { Vocabulary } from '../types/database';
import { getApiUrl } from '../utils/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import {
  parseGeneratePronunciationResponse,
  parseTtsAudioUrlResponse,
  parseTtsSettings,
  type GeneratePronunciationResponse,
  type TtsEffectiveSettings,
  type TtsSettings,
} from '@vela/common';

export type TTSResponse = GeneratePronunciationResponse;
export type TTSSettings = TtsSettings;

// In-session audio URL cache keyed by user + settings + vocabularyId.
// Presigned S3 URLs expire in 15 minutes; cache for 14 minutes to avoid serving expired URLs.
const audioUrlCache = new Map<string, { url: string; expiresAt: number }>();
const pendingAudioRequests = new Map<string, Promise<TTSResponse>>();
const CACHE_TTL_MS = 14 * 60 * 1000;
const MAX_CACHE_ENTRIES = 300;
const EXPIRED_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let lastExpiredSweepAt = 0;

export function clearAudioUrlCache(): void {
  audioUrlCache.clear();
  pendingAudioRequests.clear();
  lastExpiredSweepAt = 0;
}

function encodeCachePart(value: string): string {
  return encodeURIComponent(value);
}

function sweepExpiredEntries(now: number): void {
  for (const [key, entry] of audioUrlCache.entries()) {
    if (entry.expiresAt <= now) {
      audioUrlCache.delete(key);
    }
  }
  lastExpiredSweepAt = now;
}

function maybeSweepExpiredEntries(now: number): void {
  if (now - lastExpiredSweepAt >= EXPIRED_SWEEP_INTERVAL_MS) {
    sweepExpiredEntries(now);
  }
}

function enforceCacheSizeLimit(): void {
  while (audioUrlCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = audioUrlCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    audioUrlCache.delete(oldestKey);
  }
}

function getCachedAudioUrl(cacheKey: string): string | null {
  const now = Date.now();
  maybeSweepExpiredEntries(now);

  const cached = audioUrlCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    audioUrlCache.delete(cacheKey);
    return null;
  }

  // Refresh insertion order so recently used entries are kept when size-based eviction runs.
  audioUrlCache.delete(cacheKey);
  audioUrlCache.set(cacheKey, cached);
  return cached.url;
}

function setCachedAudioUrl(cacheKey: string, url: string): void {
  const now = Date.now();
  maybeSweepExpiredEntries(now);

  audioUrlCache.delete(cacheKey);
  audioUrlCache.set(cacheKey, { url, expiresAt: now + CACHE_TTL_MS });
  enforceCacheSizeLimit();
}

/**
 * Compare the GET /tts/settings snapshot (used to derive the client cache key)
 * against the effective settings the backend reports it actually used for the
 * generation. When they differ, the audio was produced under new settings but
 * the client key was derived from the old snapshot, so the entry must not be
 * cached under that stale key.
 *
 * When the backend omits `effectiveSettings` (older deployment), this returns
 * false to avoid caching under a settings identity the backend did not
 * confirm. Playback still succeeds; only the memory cache is skipped.
 */
function effectiveSettingsMatch(
  snapshot: TtsSettings,
  effective: TtsEffectiveSettings | undefined,
): boolean {
  if (!effective) return false;
  return (
    effective.provider === snapshot.provider &&
    effective.voiceId === snapshot.voiceId &&
    effective.model === snapshot.model
  );
}

/**
 * Generate a cache key that includes userId, provider, voice, model, and vocabularyId
 * This ensures cache isolation between users and settings
 */
function generateCacheKey(
  userId: string,
  vocabularyId: string,
  provider?: string,
  voiceId?: string,
  model?: string,
): string {
  return [
    `u=${encodeCachePart(userId)}`,
    `vocab=${encodeCachePart(vocabularyId)}`,
    `p=${encodeCachePart(provider || '')}`,
    `voice=${encodeCachePart(voiceId || '')}`,
    `m=${encodeCachePart(model || '')}`,
  ].join('|');
}

/**
 * Get Authorization header with JWT token
 */
async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();

    if (!idToken) {
      throw new Error('No authentication token available');
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
  } catch (error) {
    console.error('Failed to get auth token:', error);
    throw new Error('Authentication required. Please sign in.');
  }
}

/**
 * Generate or retrieve TTS audio for a vocabulary item.
 * Checks in-session URL cache before making a backend request.
 */
export async function generatePronunciation(
  vocabularyId: string,
  text: string,
  userId: string,
): Promise<TTSResponse> {
  // Fetch current TTS settings to ensure proper cache partitioning
  // This prevents stale audio URLs when settings change in another tab/device
  const settings = await getTTSSettings();
  const cacheKey = generateCacheKey(
    userId,
    vocabularyId,
    settings.provider,
    settings.voiceId ?? undefined,
    settings.model ?? undefined,
  );
  const cachedAudioUrl = getCachedAudioUrl(cacheKey);
  if (cachedAudioUrl) {
    return { audioUrl: cachedAudioUrl, cached: true };
  }

  const pendingRequest = pendingAudioRequests.get(cacheKey);
  if (pendingRequest) {
    return pendingRequest;
  }

  const request = (async (): Promise<TTSResponse> => {
    const headers = await getAuthHeader();

    // provider/voiceId/model are client-side cache partition keys only and are not sent to backend.
    const response = await fetch(getApiUrl('tts/generate'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        vocabularyId,
        text,
      }),
    });

    if (!response.ok) {
      const statusMessage = `Failed to generate pronunciation (status: ${response.status})`;
      let errorMessage = statusMessage;
      try {
        const responseText = await response.text();
        if (responseText) {
          try {
            const parsedError = JSON.parse(responseText) as { error?: string };
            errorMessage = parsedError.error || responseText;
          } catch {
            errorMessage = responseText;
          }
        } else {
          errorMessage = `${statusMessage}: ${response.statusText}`;
        }
      } catch {
        errorMessage = `${statusMessage}: ${response.statusText}`;
      }
      throw new Error(errorMessage);
    }

    const result = parseGeneratePronunciationResponse(await response.json());
    // Skip caching when the backend's effective settings differ from the GET
    // snapshot used to derive `cacheKey`: the audio was produced under new
    // settings and must not be served from a stale-settings cache entry.
    if (effectiveSettingsMatch(settings, result.effectiveSettings)) {
      setCachedAudioUrl(cacheKey, result.audioUrl);
    }
    return result;
  })();

  pendingAudioRequests.set(cacheKey, request);

  try {
    return await request;
  } finally {
    if (pendingAudioRequests.get(cacheKey) === request) {
      pendingAudioRequests.delete(cacheKey);
    }
  }
}

/**
 * Get audio URL for a vocabulary item (if it exists).
 * Returns null if audio doesn't exist (404).
 */
export async function getAudioUrl(vocabularyId: string, userId: string): Promise<string | null> {
  if (!vocabularyId || typeof vocabularyId !== 'string') {
    throw new Error('vocabularyId is required and must be a non-empty string');
  }

  // Fetch current TTS settings to ensure proper cache partitioning
  const settings = await getTTSSettings();
  const cacheKey = generateCacheKey(
    userId,
    vocabularyId,
    settings.provider,
    settings.voiceId ?? undefined,
    settings.model ?? undefined,
  );
  const cachedAudioUrl = getCachedAudioUrl(cacheKey);
  if (cachedAudioUrl) {
    return cachedAudioUrl;
  }

  const headers = await getAuthHeader();
  const encodedVocabularyId = encodeURIComponent(vocabularyId);

  // provider/voiceId/model are client-side cache partition keys only and are not sent to backend.
  const response = await fetch(getApiUrl(`tts/audio/${encodedVocabularyId}`), {
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch audio URL: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const parsed = parseTtsAudioUrlResponse(data);
  // Skip caching when the backend's effective settings differ from the GET
  // snapshot used to derive `cacheKey`: the audio lives under a settings
  // partition the client did not request, so it must not be served from a
  // stale-settings cache entry. The URL is still returned for immediate use.
  if (effectiveSettingsMatch(settings, parsed.effectiveSettings)) {
    setCachedAudioUrl(cacheKey, parsed.audioUrl);
  }
  return parsed.audioUrl;
}

/**
 * Save TTS settings for a user
 */
export async function saveTTSSettings(
  provider: string,
  apiKey: string,
  voiceId?: string,
  model?: string,
): Promise<void> {
  const headers = await getAuthHeader();

  const response = await fetch(getApiUrl('tts/settings'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      provider,
      apiKey,
      voiceId: voiceId || null,
      model: model || null,
    }),
  });

  if (!response.ok) {
    let errorMessage = 'Failed to save TTS settings';
    const responseClone = typeof response.clone === 'function' ? response.clone() : null;
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {
      try {
        const errorText = responseClone ? await responseClone.text() : await response.text();
        errorMessage = errorText || response.statusText || errorMessage;
      } catch {
        errorMessage = response.statusText || errorMessage;
      }
    }
    throw new Error(errorMessage);
  }

  // Clear audio URL cache when settings change to ensure new settings are applied
  clearAudioUrlCache();
}

/**
 * Get TTS settings for a user
 */
export async function getTTSSettings(_userId?: string): Promise<TTSSettings> {
  const headers = await getAuthHeader();

  const response = await fetch(getApiUrl('tts/settings'), {
    headers,
  });

  if (!response.ok) {
    let errorMessage = 'Failed to fetch TTS settings';
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {
      const errorText = await response.text();
      errorMessage = errorText || response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }

  return parseTtsSettings(await response.json());
}

/**
 * Play audio from URL
 */
export interface AudioPlaybackHandle {
  audio: HTMLAudioElement;
  finished: Promise<void>;
  stop: () => void;
}

export function playAudio(audioUrl: string): AudioPlaybackHandle {
  const audio = new Audio(audioUrl);
  let settled = false;
  let resolveFinished!: () => void;
  let rejectFinished!: (_error: Error) => void;

  const cleanup = () => {
    audio.onended = null;
    audio.onerror = null;
  };

  const resolveOnce = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveFinished();
  };

  const rejectOnce = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFinished(error);
  };

  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  audio.onended = () => resolveOnce();
  audio.onerror = () => rejectOnce(new Error('Failed to play audio'));
  audio.play().catch((error) => {
    rejectOnce(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    audio,
    finished,
    stop: () => {
      if (settled) return;
      audio.pause();
      audio.currentTime = 0;
      resolveOnce();
    },
  };
}

/**
 * Generate and play pronunciation for a vocabulary word
 */
export async function pronounceWord(word: Vocabulary, userId: string): Promise<void> {
  const { audioUrl } = await generatePronunciation(word.id, word.japanese_word, userId);
  await playAudio(audioUrl).finished;
}
