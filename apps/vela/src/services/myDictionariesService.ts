import { config } from 'src/config';
import { httpJsonAuth } from 'src/utils/httpClient';

export interface MyDictionaryEntry {
  user_id: string;
  sentence_id: string;
  sentence: string;
  source_url?: string;
  context?: string;
  created_at: number;
  updated_at: number;
}

export interface SentenceAnalysis {
  sentence: string;
  analysis: string;
  provider: string;
  model: string;
}

/**
 * Fetch dictionary entries for the current user
 */
export async function getMyDictionaries(limit = 50): Promise<MyDictionaryEntry[]> {
  try {
    const data = await httpJsonAuth<{ data?: MyDictionaryEntry[] }>(
      `${config.api.url}my-dictionaries?limit=${limit}`,
      {
        method: 'GET',
      },
    );
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
    await httpJsonAuth<{ success: boolean }>(`${config.api.url}my-dictionaries/${sentenceId}`, {
      method: 'DELETE',
    });
  } catch (error) {
    console.error('Error deleting dictionary entry:', error);
    throw error;
  }
}
