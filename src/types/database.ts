export interface Sentence {
  id: string;
  japanese_sentence: string;
  english_translation: string;
  difficulty_level?: number;
  category?: string;
  created_at: string;
  words_array: string[];
}

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
