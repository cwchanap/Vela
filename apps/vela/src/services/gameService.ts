import type { Question, SentenceQuestion, VocabularyOption } from 'src/stores/games';
import type { Vocabulary, Sentence } from 'src/types/database';
import { getApiUrl } from 'src/utils/api';
import { shuffleArray } from 'src/utils/array';
import { httpJson } from 'src/utils/httpClient';
import {
  buildDistractors,
  normalizeVocabulary,
  toVocabularyOption,
  type LegacyVocabularyPayload,
} from 'src/utils/vocabulary';

export class InsufficientVocabularyError extends Error {
  constructor() {
    super('Insufficient vocabulary for generating questions');
    this.name = 'InsufficientVocabularyError';
  }
}

async function getVocabularyPool(count = 10, jlptLevels?: number[]): Promise<Vocabulary[]> {
  let url = `games/vocabulary?limit=${count}`;
  if (jlptLevels && jlptLevels.length > 0) {
    url += `&jlpt=${jlptLevels.join(',')}`;
  }

  try {
    const data = await httpJson<{ vocabulary?: LegacyVocabularyPayload[] }>(getApiUrl(url));

    return (data.vocabulary || [])
      .map(normalizeVocabulary)
      .filter((word): word is Vocabulary => word !== null);
  } catch (error) {
    console.error('Error fetching vocabulary pool:', error);
    return [];
  }
}

async function getSentenceQuestions(count = 5): Promise<SentenceQuestion[]> {
  try {
    const data = await httpJson<{ sentences: Sentence[] }>(
      getApiUrl(`games/sentences?limit=${count}`),
    );
    const sentences: Sentence[] = data.sentences || [];

    return sentences.map((sentence) => {
      const tokens =
        Array.isArray(sentence.words_array) && sentence.words_array.length > 0
          ? [...sentence.words_array]
          : sentence.japanese_sentence.split('');
      return {
        sentence,
        scrambled: shuffleArray([...tokens]),
        correctAnswer: tokens.join(' '),
      };
    });
  } catch (error) {
    console.error('Error fetching sentences:', error);
    return [];
  }
}

async function getVocabularyQuestions(count = 10, jlptLevels?: number[]): Promise<Question[]> {
  try {
    // Over-fetch so that duplicate japanese_word values (e.g. homographs in a
    // JLPT-filtered pool) don't prevent us from building enough distractors.
    const vocabulary = await getVocabularyPool(count * 3, jlptLevels);

    // Create multiple choice questions with Japanese options
    const questions: Question[] = vocabulary
      .map((word) => {
        const distractors = buildDistractors(word, vocabulary);

        if (distractors.length < 3) {
          return null;
        }

        const options: VocabularyOption[] = shuffleArray([
          ...distractors,
          toVocabularyOption(word),
        ]);

        return {
          word,
          options,
          correctAnswer: word.id,
        };
      })
      .filter((question): question is Question => question !== null);

    return questions;
  } catch (error) {
    console.error('Error fetching vocabulary:', error);
    return [];
  }
}

async function getSentenceQuestionsWithJlpt(
  count = 5,
  jlptLevels?: number[],
): Promise<SentenceQuestion[]> {
  try {
    let url = `games/sentences?limit=${count}`;
    if (jlptLevels && jlptLevels.length > 0) {
      url += `&jlpt=${jlptLevels.join(',')}`;
    }
    const data = await httpJson<{ sentences: Sentence[] }>(getApiUrl(url));
    const sentences: Sentence[] = data.sentences || [];

    return sentences.map((sentence) => {
      const tokens =
        Array.isArray(sentence.words_array) && sentence.words_array.length > 0
          ? [...sentence.words_array]
          : sentence.japanese_sentence.split('');
      return {
        sentence,
        scrambled: shuffleArray([...tokens]),
        correctAnswer: tokens.join(' '),
      };
    });
  } catch (error) {
    console.error('Error fetching sentences:', error);
    return [];
  }
}

export const gameService = {
  getVocabularyPool,
  getVocabularyQuestions,
  getSentenceQuestions,
  getSentenceQuestionsWithJlpt,
};
