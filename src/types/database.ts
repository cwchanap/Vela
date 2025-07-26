export interface Vocabulary {
  id: string;
  japanese_word: string;
  hiragana?: string;
  katakana?: string;
  romaji?: string;
  english_translation: string;
  difficulty_level?: number;
  category?: string;
  example_sentence_jp?: string;
  example_sentence_en?: string;
  audio_url?: string;
  created_at: string;
}
