import { fetchAuthSession } from 'aws-amplify/auth';
import { config } from 'src/config';

export interface SavedSentence {
  user_id: string;
  sentence_id: string;
  sentence: string;
  source_url?: string;
  context?: string;
  created_at: number;
  updated_at: number;
}

/**
 * Fetch saved sentences for the current user
 */
export async function getSavedSentences(limit = 50): Promise<SavedSentence[]> {
  try {
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${config.api.url}saved-sentences?limit=${limit}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch saved sentences');
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching saved sentences:', error);
    throw error;
  }
}

/**
 * Delete a saved sentence
 */
export async function deleteSavedSentence(sentenceId: string): Promise<void> {
  try {
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${config.api.url}saved-sentences/${sentenceId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete sentence');
    }
  } catch (error) {
    console.error('Error deleting saved sentence:', error);
    throw error;
  }
}
