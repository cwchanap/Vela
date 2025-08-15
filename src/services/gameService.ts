import { supabase } from './supabase';
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

async function getSentenceQuestions(count = 5): Promise<SentenceQuestion[]> {
  const { data: sentences, error } = await supabase
    .from('sentences')
    .select('*')
    .limit(count)
    .returns<Sentence[]>();

  if (error) {
    console.error('Error fetching sentences:', error);
    return [];
  }

  if (!sentences) {
    return [];
  }

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
}

async function getVocabularyQuestions(count = 10): Promise<Question[]> {
  const { data: vocabulary, error } = await supabase
    .from('vocabulary')
    .select('*')
    .limit(count)
    .returns<Vocabulary[]>();

  if (error) {
    console.error('Error fetching vocabulary:', error);
    return [];
  }

  if (!vocabulary) {
    return [];
  }

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
}

export const gameService = {
  getVocabularyQuestions,
  getSentenceQuestions,
};
