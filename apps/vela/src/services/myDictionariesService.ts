import { fetchAuthSession } from 'aws-amplify/auth';
import { config } from 'src/config';

export interface MyDictionaryEntry {
  user_id: string;
  sentence_id: string;
  sentence: string;
  source_url?: string;
  context?: string;
  created_at: number;
  updated_at: number;
}

/**
 * Fetch dictionary entries for the current user
 */
export async function getMyDictionaries(limit = 50): Promise<MyDictionaryEntry[]> {
  try {
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${config.api.url}my-dictionaries?limit=${limit}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to fetch dictionary entries');
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error('Error fetching dictionary entries:', error);
    throw error;
  }
}

/**
 * Delete a dictionary entry
 */
export async function deleteDictionaryEntry(sentenceId: string): Promise<void> {
  try {
    const session = await fetchAuthSession();
    const accessToken = session.tokens?.accessToken?.toString();

    if (!accessToken) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${config.api.url}my-dictionaries/${sentenceId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete dictionary entry');
    }
  } catch (error) {
    console.error('Error deleting dictionary entry:', error);
    throw error;
  }
}
