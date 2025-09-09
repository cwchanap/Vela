import type { Question, SentenceQuestion } from 'src/stores/games';
import type { Vocabulary, Sentence } from 'src/types/database';

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

async function httpJson(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error as string;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }
  return res.json();
}

async function getSentenceQuestions(count = 5): Promise<SentenceQuestion[]> {
  try {
    const data = await httpJson(`/api/games/sentences?limit=${count}`);
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

async function getVocabularyQuestions(count = 10): Promise<Question[]> {
  try {
    const data = await httpJson(`/api/games/vocabulary?limit=${count}`);
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

export const gameService = {
  getVocabularyQuestions,
  getSentenceQuestions,
};
