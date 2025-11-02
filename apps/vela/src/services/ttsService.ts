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
 * Generate or retrieve TTS audio for a vocabulary item
 * Note: userId is no longer needed - extracted from JWT token on backend
 */
export async function generatePronunciation(
  vocabularyId: string,
  text: string,
  _userId?: string, // Deprecated parameter, kept for backward compatibility
): Promise<TTSResponse> {
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
      // If JSON parsing fails, try to get the response as text
      const errorText = await response.text();
      errorMessage = errorText || `${errorMessage}: ${response.statusText}`;
    }
    throw new Error(errorMessage);
  }

  return response.json();
}

/**
 * Get audio URL for a vocabulary item (if it exists)
 */
export async function getAudioUrl(vocabularyId: string): Promise<string | null> {
  try {
    const headers = await getAuthHeader();

    const response = await fetch(getApiUrl(`tts/audio/${vocabularyId}`), {
      headers,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.audioUrl;
  } catch (error) {
    console.error('Error fetching audio URL:', error);
    return null;
  }
}

/**
 * Save TTS settings for a user
 * Note: userId is no longer needed - extracted from JWT token on backend
 */
export async function saveTTSSettings(
  _userId: string, // Deprecated parameter, kept for backward compatibility
  apiKey: string,
  voiceId?: string,
  model?: string,
): Promise<void> {
  const headers = await getAuthHeader();

  const response = await fetch(getApiUrl('tts/settings'), {
    method: 'POST',
    headers,
    body: JSON.stringify({
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
      // If JSON parsing fails, try to get the response as text
      const errorText = await response.text();
      errorMessage = errorText || response.statusText || errorMessage;
    }
    throw new Error(errorMessage);
  }
}

/**
 * Get TTS settings for a user
 * Note: userId is no longer needed - extracted from JWT token on backend
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
      // If JSON parsing fails, try to get the response as text
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
export async function pronounceWord(word: Vocabulary, userId: string): Promise<void> {
  try {
    const { audioUrl } = await generatePronunciation(word.id, word.japanese_word, userId);
    await playAudio(audioUrl);
  } catch (error) {
    console.error('Error pronouncing word:', error);
    throw error;
  }
}
