-- Seed data for Vela Japanese Learning App
-- This file initializes the database with basic schema and sample data

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE,
    email TEXT,
    avatar_url TEXT,
    native_language TEXT DEFAULT 'English',
    current_level INTEGER DEFAULT 1,
    total_experience INTEGER DEFAULT 0,
    learning_streak INTEGER DEFAULT 0,
    last_activity TIMESTAMP WITH TIME ZONE,
    preferences JSONB DEFAULT '{"dailyGoal": 20, "difficulty": "Beginner", "notifications": true}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create vocabulary table
CREATE TABLE IF NOT EXISTS public.vocabulary (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    japanese_word TEXT NOT NULL,
    hiragana TEXT,
    katakana TEXT,
    romaji TEXT,
    english_translation TEXT NOT NULL,
    difficulty_level INTEGER DEFAULT 1,
    category TEXT DEFAULT 'general',
    example_sentence_jp TEXT,
    example_sentence_en TEXT,
    audio_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create user_progress table
CREATE TABLE IF NOT EXISTS public.user_progress (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vocabulary_id UUID REFERENCES public.vocabulary(id) ON DELETE CASCADE,
    mastery_level INTEGER DEFAULT 0,
    correct_attempts INTEGER DEFAULT 0,
    total_attempts INTEGER DEFAULT 0,
    last_reviewed TIMESTAMP WITH TIME ZONE,
    next_review TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, vocabulary_id)
);

-- Create game_sessions table
CREATE TABLE IF NOT EXISTS public.game_sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    game_type TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    duration_seconds INTEGER,
    questions_answered INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    experience_gained INTEGER DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create chat_history table
CREATE TABLE IF NOT EXISTS public.chat_history (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    message_type TEXT NOT NULL,
    content TEXT NOT NULL,
    context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON public.user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_vocabulary_id ON public.user_progress(vocabulary_id);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_id ON public.game_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON public.chat_history(user_id);
CREATE INDEX IF NOT EXISTS idx_vocabulary_difficulty ON public.vocabulary(difficulty_level);
CREATE INDEX IF NOT EXISTS idx_vocabulary_category ON public.vocabulary(category);

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Profiles: Users can only see their own profile
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Vocabulary: All users can view all vocabulary
CREATE POLICY "All users can view vocabulary" ON public.vocabulary
    FOR SELECT USING (true);

-- User Progress: Users can only see/modify their own progress
CREATE POLICY "Users can view own progress" ON public.user_progress
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can modify own progress" ON public.user_progress
    FOR ALL USING (auth.uid() = user_id);

-- Game Sessions: Users can only see/modify their own sessions
CREATE POLICY "Users can view own sessions" ON public.game_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions" ON public.game_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Chat History: Users can only see/modify their own chat history
CREATE POLICY "Users can view own chat history" ON public.chat_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own chat history" ON public.chat_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Sample vocabulary data (insert after all tables are created)
INSERT INTO public.vocabulary (japanese_word, hiragana, english_translation, difficulty_level, category, example_sentence_jp, example_sentence_en) VALUES
('こんにちは', 'こんにちは', 'Hello', 1, 'greetings', 'こんにちは、田中さん。', 'Hello, Mr. Tanaka.'),
('ありがとう', 'ありがとう', 'Thank you', 1, 'greetings', '助けてくれてありがとう。', 'Thank you for helping me.'),
('すみません', 'すみません', 'Excuse me/Sorry', 1, 'greetings', 'すみません、駅はどこですか？', 'Excuse me, where is the station?'),
('はい', 'はい', 'Yes', 1, 'basic', 'はい、そうです。', 'Yes, that is correct.'),
('いいえ', 'いいえ', 'No', 1, 'basic', 'いいえ、違います。', 'No, that is wrong.'),
('水', 'みず', 'Water', 1, 'food', '水をください。', 'Please give me water.'),
('食べる', 'たべる', 'To eat', 2, 'verbs', '寿司を食べます。', 'I eat sushi.'),
('飲む', 'のむ', 'To drink', 2, 'verbs', 'お茶を飲みます。', 'I drink tea.'),
('見る', 'みる', 'To see/To watch', 2, 'verbs', '映画を見ます。', 'I watch movies.'),
('行く', 'いく', 'To go', 2, 'verbs', '学校に行きます。', 'I go to school.');

-- Create a function to handle updated_at timestamps
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER handle_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_user_progress_updated_at
    BEFORE UPDATE ON public.user_progress
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create a trigger to create a profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
