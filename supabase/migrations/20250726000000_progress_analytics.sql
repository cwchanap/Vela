-- Achievements Table
CREATE TABLE achievements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT,
  category TEXT NOT NULL, -- 'vocabulary', 'grammar', 'streak', 'level', 'special'
  requirement_type TEXT NOT NULL, -- 'count', 'streak', 'accuracy', 'level'
  requirement_value INTEGER NOT NULL,
  experience_reward INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Achievements Table
CREATE TABLE user_achievements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  achievement_id UUID REFERENCES achievements(id),
  earned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- Daily Progress Table
CREATE TABLE daily_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  date DATE NOT NULL,
  vocabulary_studied INTEGER DEFAULT 0,
  sentences_completed INTEGER DEFAULT 0,
  time_spent_minutes INTEGER DEFAULT 0,
  experience_gained INTEGER DEFAULT 0,
  games_played INTEGER DEFAULT 0,
  accuracy_percentage DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Skill Categories Table
CREATE TABLE skill_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  color TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Skill Progress Table
CREATE TABLE user_skill_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  skill_category_id UUID REFERENCES skill_categories(id),
  level INTEGER DEFAULT 1,
  experience INTEGER DEFAULT 0,
  experience_to_next_level INTEGER DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, skill_category_id)
);

-- Learning Streaks Table
CREATE TABLE learning_streaks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  start_date DATE NOT NULL,
  end_date DATE,
  current_streak INTEGER DEFAULT 1,
  longest_streak INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skill_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_streaks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Anyone can view achievements." ON achievements FOR SELECT USING (true);

CREATE POLICY "Users can view their own achievements." ON user_achievements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own achievements." ON user_achievements FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their own daily progress." ON daily_progress FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view skill categories." ON skill_categories FOR SELECT USING (true);

CREATE POLICY "Users can manage their own skill progress." ON user_skill_progress FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own learning streaks." ON learning_streaks FOR ALL USING (auth.uid() = user_id);

-- Insert default skill categories
INSERT INTO skill_categories (name, description, icon, color) VALUES
('Vocabulary', 'Learn and master Japanese words', 'book', '#2196F3'),
('Grammar', 'Understand sentence structure and grammar rules', 'school', '#4CAF50'),
('Reading', 'Practice reading Japanese text', 'visibility', '#FF9800'),
('Listening', 'Improve listening comprehension', 'hearing', '#9C27B0'),
('Writing', 'Practice writing Japanese characters', 'edit', '#F44336');

-- Insert default achievements
INSERT INTO achievements (name, description, icon, category, requirement_type, requirement_value, experience_reward) VALUES
-- Vocabulary achievements
('First Word', 'Learn your first Japanese word', 'star', 'vocabulary', 'count', 1, 10),
('Word Explorer', 'Learn 10 Japanese words', 'explore', 'vocabulary', 'count', 10, 50),
('Vocabulary Builder', 'Learn 50 Japanese words', 'build', 'vocabulary', 'count', 50, 200),
('Word Master', 'Learn 100 Japanese words', 'emoji_events', 'vocabulary', 'count', 100, 500),
('Vocabulary Sage', 'Learn 500 Japanese words', 'psychology', 'vocabulary', 'count', 500, 1000),

-- Grammar achievements
('Grammar Novice', 'Complete your first sentence game', 'school', 'grammar', 'count', 1, 10),
('Sentence Builder', 'Complete 10 sentence games', 'construction', 'grammar', 'count', 10, 50),
('Grammar Expert', 'Complete 50 sentence games', 'verified', 'grammar', 'count', 50, 200),

-- Streak achievements
('Getting Started', 'Maintain a 3-day learning streak', 'local_fire_department', 'streak', 'streak', 3, 30),
('Consistent Learner', 'Maintain a 7-day learning streak', 'whatshot', 'streak', 'streak', 7, 70),
('Dedicated Student', 'Maintain a 30-day learning streak', 'fireplace', 'streak', 'streak', 30, 300),
('Learning Legend', 'Maintain a 100-day learning streak', 'celebration', 'streak', 'streak', 100, 1000),

-- Accuracy achievements
('Sharp Shooter', 'Achieve 90% accuracy in a vocabulary game', 'gps_fixed', 'vocabulary', 'accuracy', 90, 100),
('Perfect Score', 'Achieve 100% accuracy in any game', 'stars', 'special', 'accuracy', 100, 200),

-- Level achievements
('Level Up', 'Reach level 5', 'trending_up', 'level', 'level', 5, 100),
('Rising Star', 'Reach level 10', 'star_rate', 'level', 'level', 10, 250),
('Expert Learner', 'Reach level 25', 'workspace_premium', 'level', 'level', 25, 500);