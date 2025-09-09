import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env } from '../types';

// Validation schemas
const UserIdQuerySchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
});

const RecordGameSessionSchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  game_type: z.string().min(1, 'game_type is required'),
  score: z.number(),
  duration_seconds: z.number(),
  questions_answered: z.number(),
  correct_answers: z.number(),
  experience_gained: z.number(),
});

const progress = new Hono<{ Bindings: Env }>();

// Custom CORS handler
progress.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'content-type');

  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }

  await next();
});

/* ========================
 * Supabase implementation
 * ======================== */

async function getSupabaseClient(env: Env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

/* ============
 * Routes
 * ============ */

progress.get('/analytics', zValidator('query', UserIdQuerySchema), async (c) => {
  try {
    const { user_id } = c.req.valid('query');
    const supabase = await getSupabaseClient(c.env);

    // Get user profile for basic stats
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user_id)
      .single();

    if (!profile) {
      return c.json({ error: 'User profile not found' }, 404);
    }

    // Get vocabulary progress count
    const { count: wordsLearned } = await supabase
      .from('user_progress')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user_id)
      .gte('mastery_level', 1);

    // Get game sessions for accuracy calculation
    const { data: sessions } = await supabase
      .from('game_sessions')
      .select('correct_answers, questions_answered')
      .eq('user_id', user_id);

    let totalCorrect = 0;
    let totalQuestions = 0;
    if (sessions) {
      for (const s of sessions) {
        totalCorrect += s.correct_answers || 0;
        totalQuestions += s.questions_answered || 0;
      }
    }
    const averageAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 0;

    // Get daily progress (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: dailyProgress } = await supabase
      .from('daily_progress')
      .select('*')
      .eq('user_id', user_id)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: false });

    // Calculate level and experience
    const totalExperience = profile.total_experience || 0;
    let currentLevel = 1;
    let experienceForNextLevel = 100;

    while (currentLevel * 100 <= totalExperience) {
      currentLevel++;
    }
    experienceForNextLevel = currentLevel * 100;

    const analytics = {
      totalExperience,
      experienceToNextLevel: experienceForNextLevel - (totalExperience - (currentLevel - 1) * 100),
      currentLevel,
      wordsLearned: wordsLearned || 0,
      sentencesCompleted: 0, // TODO: Calculate from game sessions
      averageAccuracy,
      dailyProgress: dailyProgress || [],
      learningStreak: {
        current_streak: profile.learning_streak || 0,
        longest_streak: profile.learning_streak || 0,
        start_date: profile.last_activity || new Date().toISOString(),
        is_active: true,
      },
      achievements: [], // TODO: Implement achievements
    };

    return c.json(analytics);
  } catch (e) {
    console.error('progress analytics error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

progress.post('/game-session', zValidator('json', RecordGameSessionSchema), async (c) => {
  try {
    const sessionData = c.req.valid('json');
    const supabase = await getSupabaseClient(c.env);

    // Record game session
    const { error: sessionError } = await supabase.from('game_sessions').insert({
      user_id: sessionData.user_id,
      game_type: sessionData.game_type,
      score: sessionData.score,
      duration_seconds: sessionData.duration_seconds,
      questions_answered: sessionData.questions_answered,
      correct_answers: sessionData.correct_answers,
      experience_gained: sessionData.experience_gained,
    });

    if (sessionError) {
      throw new Error(`Failed to record game session: ${sessionError.message}`);
    }

    // Update daily progress
    const today = new Date().toISOString().split('T')[0];
    const { data: existingProgress } = await supabase
      .from('daily_progress')
      .select('*')
      .eq('user_id', sessionData.user_id)
      .eq('date', today)
      .maybeSingle();

    if (existingProgress) {
      await supabase
        .from('daily_progress')
        .update({
          vocabulary_studied:
            existingProgress.vocabulary_studied +
            (sessionData.game_type === 'vocabulary' ? sessionData.questions_answered : 0),
          sentences_completed:
            existingProgress.sentences_completed +
            (sessionData.game_type === 'sentence' ? sessionData.questions_answered : 0),
          time_spent_minutes:
            existingProgress.time_spent_minutes + Math.round(sessionData.duration_seconds / 60),
          experience_gained: existingProgress.experience_gained + sessionData.experience_gained,
          games_played: existingProgress.games_played + 1,
          accuracy_percentage: Math.round(
            (existingProgress.accuracy_percentage * existingProgress.games_played +
              (sessionData.questions_answered > 0
                ? (sessionData.correct_answers / sessionData.questions_answered) * 100
                : 0)) /
              (existingProgress.games_played + 1),
          ),
        })
        .eq('user_id', sessionData.user_id)
        .eq('date', today);
    } else {
      await supabase.from('daily_progress').insert({
        user_id: sessionData.user_id,
        date: today,
        vocabulary_studied:
          sessionData.game_type === 'vocabulary' ? sessionData.questions_answered : 0,
        sentences_completed:
          sessionData.game_type === 'sentence' ? sessionData.questions_answered : 0,
        time_spent_minutes: Math.round(sessionData.duration_seconds / 60),
        experience_gained: sessionData.experience_gained,
        games_played: 1,
        accuracy_percentage:
          sessionData.questions_answered > 0
            ? Math.round((sessionData.correct_answers / sessionData.questions_answered) * 100)
            : 0,
      });
    }

    // Update user experience
    const { data: profile } = await supabase
      .from('profiles')
      .select('total_experience')
      .eq('id', sessionData.user_id)
      .single();

    if (profile) {
      await supabase
        .from('profiles')
        .update({
          total_experience: (profile.total_experience || 0) + sessionData.experience_gained,
          last_activity: new Date().toISOString(),
        })
        .eq('id', sessionData.user_id);
    }

    return c.json({ success: true });
  } catch (e) {
    console.error('progress game-session error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { progress };
