-- Japanese Learning App - Remote Supabase Database Setup
-- Execute this script in your Supabase SQL Editor (https://fhiglefxknlroqqjcubk.supabase.co/project/default/sql)

-- Step 1: Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Step 2: Create tables with proper schema

-- Profiles Table (extends auth.users)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
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
CREATE TABLE public.vocabulary (
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

-- User Progress Table (tracks individual word mastery)
CREATE TABLE public.user_progress (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
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

-- Game Sessions Table
CREATE TABLE public.game_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    game_type TEXT NOT NULL, -- 'vocabulary', 'sentence', etc.
    score INTEGER DEFAULT 0,
    duration_seconds INTEGER,
    questions_answered INTEGER DEFAULT 0,
    correct_answers INTEGER DEFAULT 0,
    experience_gained INTEGER DEFAULT 0,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Chat History Table
CREATE TABLE public.chat_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    message_type TEXT NOT NULL CHECK (message_type IN ('user', 'ai')),
    content TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sentences Table for Anagram Games
CREATE TABLE public.sentences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    japanese_sentence TEXT NOT NULL,
    english_translation TEXT NOT NULL,
    difficulty_level INTEGER DEFAULT 1,
    words_array TEXT[] NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 3: Create indexes for better performance
CREATE INDEX idx_user_progress_user_id ON public.user_progress(user_id);
CREATE INDEX idx_user_progress_vocabulary_id ON public.user_progress(vocabulary_id);
CREATE INDEX idx_user_progress_next_review ON public.user_progress(next_review);
CREATE INDEX idx_game_sessions_user_id ON public.game_sessions(user_id);
CREATE INDEX idx_game_sessions_completed_at ON public.game_sessions(completed_at);
CREATE INDEX idx_chat_history_user_id ON public.chat_history(user_id);
CREATE INDEX idx_vocabulary_difficulty ON public.vocabulary(difficulty_level);
CREATE INDEX idx_vocabulary_category ON public.vocabulary(category);
CREATE INDEX idx_sentences_difficulty ON public.sentences(difficulty_level);

-- Step 4: Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentences ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS Policies

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Vocabulary policies (read-only for users)
CREATE POLICY "Users can view vocabulary" ON public.vocabulary FOR SELECT USING (true);

-- User Progress policies
CREATE POLICY "Users can manage their own progress" ON public.user_progress FOR ALL USING (auth.uid() = user_id);

-- Game Sessions policies
CREATE POLICY "Users can manage their own game sessions" ON public.game_sessions FOR ALL USING (auth.uid() = user_id);

-- Chat History policies
CREATE POLICY "Users can manage their own chat history" ON public.chat_history FOR ALL USING (auth.uid() = user_id);

-- Sentences policies (read-only for users)
CREATE POLICY "Users can view sentences" ON public.sentences FOR SELECT USING (true);

-- Step 6: Create trigger function for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Create triggers for updated_at
CREATE TRIGGER handle_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER handle_user_progress_updated_at
    BEFORE UPDATE ON public.user_progress
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Step 8: Create function to handle user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 9: Create trigger for new user creation
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Step 10: Insert sample vocabulary data
INSERT INTO public.vocabulary (japanese_word, hiragana, romaji, english_translation, difficulty_level, category, example_sentence_jp, example_sentence_en) VALUES
('こんにちは', NULL, 'konnichiwa', 'hello', 1, 'greeting', 'こんにちは、田中さん。', 'Hello, Mr. Tanaka.'),
('ありがとう', NULL, 'arigatou', 'thank you', 1, 'expression', 'ありがとうございます。', 'Thank you very much.'),
('はい', NULL, 'hai', 'yes', 1, 'response', 'はい、そうです。', 'Yes, that is correct.'),
('いいえ', NULL, 'iie', 'no', 1, 'response', 'いいえ、違います。', 'No, that is wrong.'),
('すみません', NULL, 'sumimasen', 'excuse me/sorry', 2, 'expression', 'すみません、質問があります。', 'Excuse me, I have a question.'),
('お願いします', NULL, 'onegaishimasu', 'please', 2, 'expression', 'お水をお願いします。', 'Water, please.'),
('おはようございます', NULL, 'ohayou gozaimasu', 'good morning', 2, 'greeting', 'おはようございます、先生。', 'Good morning, teacher.'),
('こんばんは', NULL, 'konbanwa', 'good evening', 2, 'greeting', 'こんばんは、皆さん。', 'Good evening, everyone.'),
('さようなら', NULL, 'sayounara', 'goodbye', 2, 'greeting', 'さようなら、また明日。', 'Goodbye, see you tomorrow.'),
('おやすみなさい', NULL, 'oyasuminasai', 'good night', 2, 'greeting', 'おやすみなさい、母さん。', 'Good night, mom.');

-- Step 11: Insert sample sentences for anagram games
INSERT INTO public.sentences (japanese_sentence, english_translation, difficulty_level, words_array) VALUES
('私は学生です', 'I am a student', 1, ARRAY['私', 'は', '学生', 'です']),
('これは本です', 'This is a book', 1, ARRAY['これ', 'は', '本', 'です']),
('彼は先生です', 'He is a teacher', 2, ARRAY['彼', 'は', '先生', 'です']),
('今日は暑いです', 'Today is hot', 2, ARRAY['今日', 'は', '暑い', 'です']),
('私は日本語を勉強します', 'I study Japanese', 3, ARRAY['私', 'は', '日本語', 'を', '勉強', 'します']),
('あなたは元気ですか', 'Are you healthy?', 2, ARRAY['あなた', 'は', '元気', 'です', 'か']),
('私はコーヒーが好きです', 'I like coffee', 2, ARRAY['私', 'は', 'コーヒー', 'が', '好き', 'です']),
('彼女は美しいです', 'She is beautiful', 2, ARRAY['彼女', 'は', '美しい', 'です']),
('私は東京に行きます', 'I go to Tokyo', 3, ARRAY['私', 'は', '東京', 'に', '行き', 'ます']),
('今日は良い天気です', 'Today is good weather', 2, ARRAY['今日', 'は', '良い', '天気', 'です']);

-- Step 12: Verify setup
SELECT 
    'profiles' as table_name, count(*) as row_count FROM public.profiles
UNION ALL
SELECT 'vocabulary', count(*) FROM public.vocabulary
UNION ALL
SELECT 'sentences', count(*) FROM public.sentences
UNION ALL
SELECT 'user_progress', count(*) FROM public.user_progress
UNION ALL
SELECT 'game_sessions', count(*) FROM public.game_sessions
UNION ALL
SELECT 'chat_history', count(*) FROM public.chat_history;

-- Instructions for use:
-- 1. Copy this entire script
-- 2. Go to your Supabase dashboard: https://fhiglefxknlroqqjcubk.supabase.co/project/default/sql
-- 3. Paste and execute the script
-- 4. Update your .env file with your actual Supabase credentials
-- 5. Your Japanese learning app database is now ready!
