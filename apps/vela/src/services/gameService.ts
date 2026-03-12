import type { Question, SentenceQuestion, VocabularyOption } from 'src/stores/games';
import type { Vocabulary, Sentence } from 'src/types/database';
import { getApiUrl } from 'src/utils/api';
import { httpJson } from 'src/utils/httpClient';
import { normalizeVocabulary, toVocabularyOption } from 'src/utils/vocabulary';

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
    const data = await httpJson<{ vocabulary: Array<Vocabulary & { japanese?: string }> }>(
      getApiUrl(url),
    );
    const vocabulary: Vocabulary[] = (data.vocabulary || [])
      .map(normalizeVocabulary)
      .filter((word): word is Vocabulary => word !== null);

    // Create multiple choice questions with Japanese options
    const questions: Question[] = vocabulary
      .map((word) => {
        const distractorPool = shuffle(
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
          const remainingVocabulary = shuffle(
            vocabulary.filter(
              (candidate) =>
                candidate.id !== word.id &&
                candidate.japanese_word !== word.japanese_word &&
                !seenTexts.has(candidate.japanese_word),
            ),
          );

          for (const candidate of remainingVocabulary) {
            seenTexts.add(candidate.japanese_word);
            distractors.push(toVocabularyOption(candidate));

            if (distractors.length === 3) {
              break;
            }
          }
        }

        if (distractors.length < 3) {
          return null;
        }

        const options: VocabularyOption[] = shuffle([...distractors, toVocabularyOption(word)]);

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
