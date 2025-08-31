-- Profiles Table
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT,
  avatar_url TEXT,
  native_language TEXT DEFAULT 'en',
  current_level INTEGER DEFAULT 1,
  total_experience INTEGER DEFAULT 0,
  learning_streak INTEGER DEFAULT 0,
  last_activity TIMESTAMP WITH TIME ZONE,
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Vocabulary Table
CREATE TABLE vocabulary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  japanese_word TEXT NOT NULL,
  hiragana TEXT,
  katakana TEXT,
  romaji TEXT,
  english_translation TEXT NOT NULL,
  difficulty_level INTEGER DEFAULT 1,
  category TEXT,
  example_sentence_jp TEXT,
  example_sentence_en TEXT,
  audio_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Progress Table
CREATE TABLE user_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  vocabulary_id UUID REFERENCES vocabulary(id),
  mastery_level INTEGER DEFAULT 0,
  correct_attempts INTEGER DEFAULT 0,
  total_attempts INTEGER DEFAULT 0,
  last_reviewed TIMESTAMP WITH TIME ZONE,
  next_review TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Game Sessions Table
CREATE TABLE game_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  game_type TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  duration_seconds INTEGER,
  questions_answered INTEGER DEFAULT 0,
  correct_answers INTEGER DEFAULT 0,
  experience_gained INTEGER DEFAULT 0,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat History Table
CREATE TABLE chat_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  message_type TEXT NOT NULL, -- 'user' or 'ai'
  content TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own profile." ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile." ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view vocabulary." ON vocabulary FOR SELECT USING (true);

CREATE POLICY "Users can manage their own progress." ON user_progress FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own game sessions." ON game_sessions FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own chat history." ON chat_history FOR ALL USING (auth.uid() = user_id);
