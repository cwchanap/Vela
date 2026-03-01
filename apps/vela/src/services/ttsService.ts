import type { Vocabulary } from '../types/database';
import { getApiUrl } from '../utils/api';
import { fetchAuthSession } from 'aws-amplify/auth';

export interface TTSResponse {
  audioUrl: string;
  cached: boolean;
}

export interface TTSSettings {
  provider: string;
  voiceId: string | null;
  model: string | null;
  hasApiKey: boolean;
}

// In-session audio URL cache keyed by user + settings + vocabularyId.
// Presigned S3 URLs expire in 15 minutes; cache for 14 minutes to avoid serving expired URLs.
const audioUrlCache = new Map<string, { url: string; expiresAt: number }>();
const CACHE_TTL_MS = 14 * 60 * 1000;

export function clearAudioUrlCache(): void {
  audioUrlCache.clear();
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
  const settingsPart = provider ? `${provider}:${voiceId || ''}:${model || ''}` : '';
  return settingsPart ? `${userId}:${settingsPart}:${vocabularyId}` : `${userId}:${vocabularyId}`;
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
  provider?: string,
  voiceId?: string,
  model?: string,
): Promise<TTSResponse> {
  const cacheKey = generateCacheKey(userId, vocabularyId, provider, voiceId, model);
  const cached = audioUrlCache.get(cacheKey);

  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return { audioUrl: cached.url, cached: true };
    }
    // Remove expired entry to prevent unbounded cache growth
    audioUrlCache.delete(cacheKey);
  }

  const headers = await getAuthHeader();

  const response = await fetch(getApiUrl('tts/generate'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      vocabularyId,
      text,
    }),
  });

  if (!response.ok) {
    let errorMessage = `Failed to generate pronunciation (status: ${response.status})`;
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {
      const errorText = await response.text();
      errorMessage = errorText || `${errorMessage}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  const result: TTSResponse = await response.json();
  audioUrlCache.set(cacheKey, { url: result.audioUrl, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/**
 * Get audio URL for a vocabulary item (if it exists).
 * Returns null if audio doesn't exist (404).
 */
export async function getAudioUrl(
  vocabularyId: string,
  userId: string,
  provider?: string,
  voiceId?: string,
  model?: string,
): Promise<string | null> {
  if (!vocabularyId || typeof vocabularyId !== 'string') {
    throw new Error('vocabularyId is required and must be a non-empty string');
  }

  const cacheKey = generateCacheKey(userId, vocabularyId, provider, voiceId, model);
  const cached = audioUrlCache.get(cacheKey);

  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return cached.url;
    }
    // Remove expired entry to prevent unbounded cache growth
    audioUrlCache.delete(cacheKey);
  }

  const headers = await getAuthHeader();
  const encodedVocabularyId = encodeURIComponent(vocabularyId);

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
  audioUrlCache.set(cacheKey, { url: data.audioUrl, expiresAt: Date.now() + CACHE_TTL_MS });
  return data.audioUrl;
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
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch {
      const errorText = await response.text();
      errorMessage = errorText || response.statusText || errorMessage;
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

  return response.json();
}

/**
 * Play audio from URL
 */
export function playAudio(audioUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(audioUrl);

    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('Failed to play audio'));

    audio.play().catch(reject);
  });
}

/**
 * Generate and play pronunciation for a vocabulary word
 */
export async function pronounceWord(
  word: Vocabulary,
  userId: string,
  provider?: string,
  voiceId?: string,
  model?: string,
): Promise<void> {
  try {
    const { audioUrl } = await generatePronunciation(
      word.id,
      word.japanese_word,
      userId,
      provider,
      voiceId,
      model,
    );
    await playAudio(audioUrl);
  } catch (error) {
    console.error('Error pronouncing word:', error);
    throw error;
  }
}
