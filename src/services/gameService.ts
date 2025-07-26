import { supabase } from './supabase';
import type { Question } from 'src/stores/games';
import type { Vocabulary } from 'src/types/database';

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
};
