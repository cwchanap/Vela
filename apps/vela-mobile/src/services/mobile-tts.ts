import {
  parseGeneratePronunciationRequest,
  parseGeneratePronunciationResponse,
  parseTtsApiErrorResponse,
  parseTtsSettings,
  type TtsApiErrorCode,
  type TtsSettings,
} from '@vela/common';
import { MobileApiError, type MobileApiClient } from './mobile-api-client';

export const MOBILE_TTS_GENERATE_TIMEOUT_MS = 45_000;

const MOBILE_TTS_CACHE_TTL_MS = 14 * 60_000;
const MOBILE_TTS_CACHE_MAX_ENTRIES = 300;
const MOBILE_TTS_CACHE_SWEEP_INTERVAL_MS = 5 * 60_000;

export type MobilePronunciationInput = {
  userId: string;
  vocabularyId: string;
  text: string;
};

export type PreparationTimings = {
  settingsMs: number;
  generateMs: number;
};

export type PreparedPronunciation = {
  audioUrl: string;
  source: 'memory-cache' | 'server-cache' | 'generated';
  expiresAt: number;
  timings: PreparationTimings;
};

export type MobileTtsErrorCode =
  | 'invalid_input'
  | 'not_configured'
  | 'session_unavailable'
  | 'session_changed'
  | 'session_recovery_pending'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'service_unavailable'
  | 'generation_timeout'
  | 'generation_failed'
  | 'invalid_response';

export class MobileTtsError extends Error {
  constructor(
    readonly code: MobileTtsErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    Object.defineProperty(this, 'name', {
      value: 'MobileTtsError',
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
}

export type MobileTtsService = {
  preparePronunciation(
    input: MobilePronunciationInput,
    options?: { signal?: AbortSignal },
  ): Promise<PreparedPronunciation>;
  invalidatePronunciation(userId: string, vocabularyId: string): void;
  clearUser(userId: string): void;
  clearAll(): void;
};

type NormalizedInput = {
  userId: string;
  vocabularyId: string;
  text: string;
};

type CacheEntry = {
  userId: string;
  vocabularyId: string;
  audioUrl: string;
  expiresAt: number;
};

type PendingResult = {
  audioUrl: string;
  source: 'server-cache' | 'generated';
  expiresAt: number;
  generateMs: number;
};

type PendingEntry = {
  userId: string;
  vocabularyId: string;
  userGeneration: number;
  vocabularyGeneration: number;
  clearGeneration: number;
  promise: Promise<PendingResult>;
};

const STABLE_ERROR_CODE_MAP: Record<TtsApiErrorCode, MobileTtsErrorCode> = {
  tts_not_configured: 'not_configured',
  tts_invalid_provider_configuration: 'generation_failed',
  tts_audio_service_unavailable: 'service_unavailable',
  tts_generation_timeout: 'generation_timeout',
  tts_generation_failed: 'generation_failed',
  tts_audio_storage_failed: 'generation_failed',
  tts_audio_access_failed: 'generation_failed',
};

const LEGACY_NOT_CONFIGURED_MESSAGE = 'TTS API key not configured. Please configure in Settings.';
const LEGACY_INVALID_PROVIDER_MESSAGE = 'Invalid TTS provider configuration';

function normalizeInput(input: MobilePronunciationInput): NormalizedInput {
  if (typeof input?.userId !== 'string' || !input.userId.trim()) {
    throw new MobileTtsError('invalid_input');
  }

  let request: ReturnType<typeof parseGeneratePronunciationRequest>;
  try {
    request = parseGeneratePronunciationRequest(input);
  } catch {
    throw new MobileTtsError('invalid_input');
  }

  return {
    userId: input.userId.trim(),
    vocabularyId: request.vocabularyId,
    text: request.text,
  };
}

function recognizedServerCode(error: MobileApiError): TtsApiErrorCode | undefined {
  try {
    return parseTtsApiErrorResponse(error.details.serverBody).code;
  } catch {
    return undefined;
  }
}

function exactServerMessage(serverBody: unknown): string | undefined {
  if (typeof serverBody !== 'object' || serverBody === null || Array.isArray(serverBody)) {
    return undefined;
  }
  const message = (serverBody as Record<string, unknown>).error;
  return typeof message === 'string' ? message : undefined;
}

function mapApiError(error: unknown): MobileTtsError {
  if (!(error instanceof MobileApiError)) {
    return new MobileTtsError('generation_failed');
  }

  const stableCode = recognizedServerCode(error);
  if (stableCode) {
    return new MobileTtsError(STABLE_ERROR_CODE_MAP[stableCode]);
  }

  if (error.details.status === 400) {
    const legacyMessage = exactServerMessage(error.details.serverBody);
    if (legacyMessage === LEGACY_NOT_CONFIGURED_MESSAGE) {
      return new MobileTtsError('not_configured');
    }
    if (legacyMessage === LEGACY_INVALID_PROVIDER_MESSAGE) {
      return new MobileTtsError('generation_failed');
    }
  }

  switch (error.code) {
    case 'session_unavailable':
    case 'session_changed':
    case 'session_recovery_pending':
    case 'unauthorized':
    case 'forbidden':
    case 'network':
      return new MobileTtsError(error.code);
  }

  switch (error.details.status) {
    case 400:
      return new MobileTtsError('invalid_input');
    case 401:
      return new MobileTtsError('unauthorized');
    case 403:
      return new MobileTtsError('forbidden');
    case 503:
      return new MobileTtsError('service_unavailable');
    case 504:
      return new MobileTtsError('generation_timeout');
  }

  if (error.details.status !== undefined && error.details.status >= 500) {
    return new MobileTtsError('generation_failed');
  }
  if (error.details.status !== undefined && error.details.status >= 400) {
    return new MobileTtsError('invalid_input');
  }
  if (error.code === 'invalid_response') {
    return new MobileTtsError('invalid_response');
  }
  if (error.code === 'invalid_request' || error.code === 'client') {
    return new MobileTtsError('invalid_input');
  }
  return new MobileTtsError('generation_failed');
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function detachOnAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function cacheKey(input: NormalizedInput, settings: TtsSettings): string {
  // `vocabularyId` and `text` are an immutable canonical pair in the backend.
  // This service validates non-empty text but deliberately does not include it
  // in the client cache identity or attempt to enforce that backend invariant.
  return [
    input.userId,
    input.vocabularyId,
    settings.provider,
    settings.voiceId ?? '',
    settings.model ?? '',
  ]
    .map(encodeURIComponent)
    .join('|');
}

function vocabularyGenerationKey(userId: string, vocabularyId: string): string {
  return [userId, vocabularyId].map(encodeURIComponent).join('|');
}

export function createMobileTtsService(apiClient: MobileApiClient): MobileTtsService {
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, PendingEntry>();
  const userGenerations = new Map<string, number>();
  const vocabularyGenerations = new Map<string, number>();
  let clearGeneration = 0;
  let lastExpiredSweepAt = Date.now();

  function userGeneration(userId: string): number {
    const generation = userGenerations.get(userId) ?? 0;
    if (!userGenerations.has(userId)) userGenerations.set(userId, generation);
    return generation;
  }

  function vocabularyGeneration(userId: string, vocabularyId: string): number {
    const key = vocabularyGenerationKey(userId, vocabularyId);
    const generation = vocabularyGenerations.get(key) ?? 0;
    if (!vocabularyGenerations.has(key)) vocabularyGenerations.set(key, generation);
    return generation;
  }

  function sweepExpired(now: number): void {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    lastExpiredSweepAt = now;
  }

  function maybeSweepExpired(now: number): void {
    if (now - lastExpiredSweepAt >= MOBILE_TTS_CACHE_SWEEP_INTERVAL_MS) {
      sweepExpired(now);
    }
  }

  function getCached(key: string): CacheEntry | undefined {
    const now = Date.now();
    maybeSweepExpired(now);
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      cache.delete(key);
      return undefined;
    }

    cache.delete(key);
    cache.set(key, entry);
    return entry;
  }

  function setCached(key: string, entry: CacheEntry): void {
    maybeSweepExpired(Date.now());
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > MOBILE_TTS_CACHE_MAX_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
  }

  async function prepare(
    input: NormalizedInput,
    capturedUserGeneration: number,
    capturedVocabularyGeneration: number,
    capturedClearGeneration: number,
  ): Promise<PreparedPronunciation> {
    const requestController = new AbortController();
    const settingsStartedAt = Date.now();
    let settingsValue: unknown;
    try {
      settingsValue = await apiClient.getJson('tts/settings', {
        signal: requestController.signal,
      });
    } catch (error) {
      throw mapApiError(error);
    }
    const settingsMs = Date.now() - settingsStartedAt;

    let settings: TtsSettings;
    try {
      settings = parseTtsSettings(settingsValue);
    } catch {
      throw new MobileTtsError('invalid_response');
    }
    if (!settings.hasApiKey) throw new MobileTtsError('not_configured');

    const key = cacheKey(input, settings);
    const cached = getCached(key);
    if (cached) {
      return {
        audioUrl: cached.audioUrl,
        source: 'memory-cache',
        expiresAt: cached.expiresAt,
        timings: { settingsMs, generateMs: 0 },
      };
    }

    const generationsAreCurrent =
      userGeneration(input.userId) === capturedUserGeneration &&
      vocabularyGeneration(input.userId, input.vocabularyId) === capturedVocabularyGeneration &&
      clearGeneration === capturedClearGeneration;
    const indexedPending = generationsAreCurrent ? pending.get(key) : undefined;
    let pendingEntry =
      indexedPending?.userGeneration === capturedUserGeneration &&
      indexedPending.vocabularyGeneration === capturedVocabularyGeneration &&
      indexedPending.clearGeneration === capturedClearGeneration
        ? indexedPending
        : undefined;
    if (!pendingEntry) {
      const generateStartedAt = Date.now();
      const generationPromise = (async (): Promise<PendingResult> => {
        let responseValue: unknown;
        try {
          responseValue = await apiClient.postJson(
            'tts/generate',
            { vocabularyId: input.vocabularyId, text: input.text },
            { signal: requestController.signal, timeoutMs: MOBILE_TTS_GENERATE_TIMEOUT_MS },
          );
        } catch (error) {
          throw mapApiError(error);
        }

        let response: ReturnType<typeof parseGeneratePronunciationResponse>;
        try {
          response = parseGeneratePronunciationResponse(responseValue);
        } catch {
          throw new MobileTtsError('invalid_response');
        }

        const completedAt = Date.now();
        const expiresAt = completedAt + MOBILE_TTS_CACHE_TTL_MS;
        if (
          userGeneration(input.userId) === capturedUserGeneration &&
          vocabularyGeneration(input.userId, input.vocabularyId) === capturedVocabularyGeneration &&
          clearGeneration === capturedClearGeneration
        ) {
          setCached(key, {
            userId: input.userId,
            vocabularyId: input.vocabularyId,
            audioUrl: response.audioUrl,
            expiresAt,
          });
        }

        return {
          audioUrl: response.audioUrl,
          source: response.cached ? 'server-cache' : 'generated',
          expiresAt,
          generateMs: completedAt - generateStartedAt,
        };
      })();
      pendingEntry = {
        userId: input.userId,
        vocabularyId: input.vocabularyId,
        userGeneration: capturedUserGeneration,
        vocabularyGeneration: capturedVocabularyGeneration,
        clearGeneration: capturedClearGeneration,
        promise: generationPromise,
      };
      if (generationsAreCurrent) {
        pending.set(key, pendingEntry);

        const removeOwnedPending = () => {
          if (pending.get(key) === pendingEntry) pending.delete(key);
        };
        void generationPromise.then(removeOwnedPending, removeOwnedPending);
      }
    }

    const result = await pendingEntry.promise;
    return {
      audioUrl: result.audioUrl,
      source: result.source,
      expiresAt: result.expiresAt,
      timings: { settingsMs, generateMs: result.generateMs },
    };
  }

  return {
    preparePronunciation(input, options = {}) {
      if (options.signal?.aborted) return Promise.reject(abortError());

      let normalized: NormalizedInput;
      try {
        normalized = normalizeInput(input);
      } catch (error) {
        return Promise.reject(error);
      }

      const work = prepare(
        normalized,
        userGeneration(normalized.userId),
        vocabularyGeneration(normalized.userId, normalized.vocabularyId),
        clearGeneration,
      );
      return detachOnAbort(work, options.signal);
    },

    invalidatePronunciation(userId, vocabularyId) {
      const normalizedUserId = userId.trim();
      const normalizedVocabularyId = vocabularyId.trim();
      const generationKey = vocabularyGenerationKey(normalizedUserId, normalizedVocabularyId);
      vocabularyGenerations.set(generationKey, (vocabularyGenerations.get(generationKey) ?? 0) + 1);

      for (const [key, entry] of cache) {
        if (entry.userId === normalizedUserId && entry.vocabularyId === normalizedVocabularyId) {
          cache.delete(key);
        }
      }
      for (const [key, entry] of pending) {
        if (entry.userId === normalizedUserId && entry.vocabularyId === normalizedVocabularyId) {
          pending.delete(key);
        }
      }
    },

    clearUser(userId) {
      const normalizedUserId = userId.trim();
      userGenerations.set(normalizedUserId, userGeneration(normalizedUserId) + 1);
      const vocabularyGenerationPrefix = `${encodeURIComponent(normalizedUserId)}|`;
      for (const key of vocabularyGenerations.keys()) {
        if (key.startsWith(vocabularyGenerationPrefix)) vocabularyGenerations.delete(key);
      }

      for (const [key, entry] of cache) {
        if (entry.userId === normalizedUserId) cache.delete(key);
      }
      for (const [key, entry] of pending) {
        if (entry.userId === normalizedUserId) pending.delete(key);
      }
    },

    clearAll() {
      clearGeneration += 1;
      userGenerations.clear();
      vocabularyGenerations.clear();
      cache.clear();
      pending.clear();
      lastExpiredSweepAt = Date.now();
    },
  };
}
