import type { Question, SentenceQuestion } from 'src/stores/games';
import type { Vocabulary, Sentence } from 'src/types/database';
import { getApiUrl } from 'src/utils/api';
import { httpJson } from 'src/utils/httpClient';

function shuffle<T>(array: T[]): T[] {
  let currentIndex = array.length,
    randomIndex;

  while (currentIndex !== 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [array[currentIndex], array[randomIndex]] = [array[randomIndex]!, array[currentIndex]!];
  }

  return array;
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
        scrambled: shuffle([...tokens]),
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
    let url = `games/vocabulary?limit=${count}`;
    if (jlptLevels && jlptLevels.length > 0) {
      url += `&jlpt=${jlptLevels.join(',')}`;
    }
    const data = await httpJson<{ vocabulary: Vocabulary[] }>(getApiUrl(url));
    const vocabulary: Vocabulary[] = data.vocabulary || [];

    // Create multiple choice questions
    const questions: Question[] = vocabulary.map((word) => {
      const options = vocabulary
        .filter((v) => v.id !== word.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map((v) => v.english_translation);
      options.push(word.english_translation);

      return {
        word: word,
        options: options.sort(() => 0.5 - Math.random()),
        correctAnswer: word.english_translation,
      };
    });

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
        scrambled: shuffle([...tokens]),
        correctAnswer: tokens.join(' '),
      };
    });
  } catch (error) {
    console.error('Error fetching sentences:', error);
    return [];
  }
}

export const gameService = {
  getVocabularyQuestions,
  getSentenceQuestions,
  getSentenceQuestionsWithJlpt,
};
