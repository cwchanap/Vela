import type { ListeningConfig, ListeningQuestion } from '../types/listening';
import type { Vocabulary, Sentence } from '../types/database';
import { getApiUrl } from '../utils/api';
import { httpJson } from '../utils/httpClient';
import { shuffleArray } from '../utils/array';
import { normalizeVocabulary, type LegacyVocabularyPayload } from '../utils/vocabulary';

async function getListeningQuestions(
  config: ListeningConfig,
  count = 10,
): Promise<ListeningQuestion[]> {
  return config.source === 'vocabulary'
    ? getVocabularyQuestions(config, count)
    : getSentenceQuestions(config, count);
}

async function getVocabularyQuestions(
  config: ListeningConfig,
  count: number,
): Promise<ListeningQuestion[]> {
  // Over-fetch to have enough items for distractor selection
  let url = `games/vocabulary?limit=${count * 2}`;
  if (config.jlptLevels.length > 0) {
    url += `&jlpt=${config.jlptLevels.join(',')}`;
  }

  const data = await httpJson<{ vocabulary?: LegacyVocabularyPayload[] }>(getApiUrl(url));
  const pool = (data.vocabulary ?? [])
    .map(normalizeVocabulary)
    .filter((v): v is Vocabulary => v !== null);

  const questions: ListeningQuestion[] = [];
  for (const word of pool) {
    if (questions.length >= count) break;
    const distractors = buildEnglishDistractors(word.english_translation, pool);
    if (distractors.length < 3) continue;
    questions.push({
      kind: 'vocabulary',
      id: word.id,
      text: word.japanese_word,
      englishTranslation: word.english_translation,
      distractors: distractors as [string, string, string],
      raw: word,
      ...(word.hiragana ? { reading: word.hiragana } : {}),
      ...(word.romaji ? { romaji: word.romaji } : {}),
    });
  }
  return questions;
}

async function getSentenceQuestions(
  config: ListeningConfig,
  count: number,
): Promise<ListeningQuestion[]> {
  // Fetch extra items to have enough for distractors
  let url = `games/sentences?limit=${count * 2}`;
  if (config.jlptLevels.length > 0) {
    url += `&jlpt=${config.jlptLevels.join(',')}`;
  }

  const data = await httpJson<{ sentences: Sentence[] }>(getApiUrl(url));
  const pool: Sentence[] = data.sentences ?? [];

  const questions: ListeningQuestion[] = [];
  for (const sentence of pool) {
    if (questions.length >= count) break;
    const distractors = buildEnglishDistractors(sentence.english_translation, pool);
    if (distractors.length < 3) continue;
    questions.push({
      kind: 'sentence',
      id: sentence.id,
      text: sentence.japanese_sentence,
      englishTranslation: sentence.english_translation,
      distractors: distractors as [string, string, string],
      raw: sentence,
    });
  }
  return questions;
}

function buildEnglishDistractors(
  correctTranslation: string,
  pool: Array<{ english_translation: string }>,
  count = 3,
): string[] {
  const seen = new Set<string>([correctTranslation.toLowerCase()]);
  const distractors: string[] = [];

  for (const item of shuffleArray([...pool])) {
    if (distractors.length >= count) break;
    const candidate = item.english_translation;
    if (!seen.has(candidate.toLowerCase())) {
      seen.add(candidate.toLowerCase());
      distractors.push(candidate);
    }
  }

  return distractors;
}

export const listeningGameService = {
  getListeningQuestions,
};
