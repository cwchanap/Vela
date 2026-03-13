import type { Question, SentenceQuestion, VocabularyOption } from 'src/stores/games';

export class InsufficientVocabularyError extends Error {
  constructor() {
    super('Insufficient vocabulary for generating questions');
    this.name = 'InsufficientVocabularyError';
  }
}
import type { Vocabulary, Sentence } from 'src/types/database';
import { getApiUrl } from 'src/utils/api';
import { httpJson } from 'src/utils/httpClient';
import { normalizeVocabulary, toVocabularyOption } from 'src/utils/vocabulary';
import { shuffleArray } from 'src/utils/array';

async function getVocabularyPool(count = 10, jlptLevels?: number[]): Promise<Vocabulary[]> {
  let url = `games/vocabulary?limit=${count}`;
  if (jlptLevels && jlptLevels.length > 0) {
    url += `&jlpt=${jlptLevels.join(',')}`;
  }

  const data = await httpJson<{ vocabulary: Array<Vocabulary & { japanese?: string }> }>(
    getApiUrl(url),
  );

  return (data.vocabulary || [])
    .map(normalizeVocabulary)
    .filter((word): word is Vocabulary => word !== null);
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
    const vocabulary = await getVocabularyPool(count, jlptLevels);

    // Create multiple choice questions with Japanese options
    const questions: Question[] = vocabulary
      .map((word) => {
        const distractorPool = shuffleArray(
          vocabulary.filter((v) => v.id !== word.id && v.japanese_word !== word.japanese_word),
        );
        const seenTexts = new Set<string>([word.japanese_word]);
        const distractors: VocabularyOption[] = [];

        for (const candidate of distractorPool) {
          if (seenTexts.has(candidate.japanese_word)) {
            continue;
          }

          seenTexts.add(candidate.japanese_word);
          distractors.push(toVocabularyOption(candidate));

          if (distractors.length === 3) {
            break;
          }
        }

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
