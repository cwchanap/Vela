import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import {
  profiles as profilesDB,
  gameSessions as gameSessionsDB,
  dailyProgress as dailyProgressDB,
} from '../dynamodb';

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

/* ============
 * Routes
 * ============ */

progress.get('/analytics', zValidator('query', UserIdQuerySchema), async (c) => {
  try {
    const { user_id } = c.req.valid('query');

    // Get user profile for basic stats
    const profile = await profilesDB.get(user_id);

    if (!profile) {
      return c.json({ error: 'User profile not found' }, 404);
    }

    // For now, we'll return a simplified analytics object
    // In a real implementation, you would calculate these values from the data
    const analytics = {
      totalExperience: profile.total_experience || 0,
      experienceToNextLevel: 100, // Simplified
      currentLevel: profile.current_level || 1,
      wordsLearned: 0, // TODO: Calculate from user progress
      sentencesCompleted: 0, // TODO: Calculate from game sessions
      averageAccuracy: 0, // TODO: Calculate from game sessions
      dailyProgress: [], // TODO: Get from daily progress table
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

    // Record game session
    const session = {
      user_id: sessionData.user_id,
      game_type: sessionData.game_type,
      score: sessionData.score,
      duration_seconds: sessionData.duration_seconds,
      questions_answered: sessionData.questions_answered,
      correct_answers: sessionData.correct_answers,
      experience_gained: sessionData.experience_gained,
      created_at: new Date().toISOString(),
    };

    await gameSessionsDB.create(session);

    // Update daily progress
    const today = new Date().toISOString().split('T')[0];
    let dailyProgress = await dailyProgressDB.getByUserAndDate(sessionData.user_id, today);

    if (dailyProgress) {
      // Update existing daily progress
      await dailyProgressDB.update(sessionData.user_id, today, {
        vocabulary_studied:
          dailyProgress.vocabulary_studied +
          (sessionData.game_type === 'vocabulary' ? sessionData.questions_answered : 0),
        sentences_completed:
          dailyProgress.sentences_completed +
          (sessionData.game_type === 'sentence' ? sessionData.questions_answered : 0),
        time_spent_minutes:
          dailyProgress.time_spent_minutes + Math.round(sessionData.duration_seconds / 60),
        experience_gained: dailyProgress.experience_gained + sessionData.experience_gained,
        games_played: dailyProgress.games_played + 1,
        accuracy_percentage: Math.round(
          (dailyProgress.accuracy_percentage * dailyProgress.games_played +
            (sessionData.questions_answered > 0
              ? (sessionData.correct_answers / sessionData.questions_answered) * 100
              : 0)) /
            (dailyProgress.games_played + 1),
        ),
      });
    } else {
      // Create new daily progress
      const newProgress = {
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
      };
      await dailyProgressDB.create(newProgress);
    }

    // Update user experience
    const profile = await profilesDB.get(sessionData.user_id);
    if (profile) {
      await profilesDB.update(sessionData.user_id, {
        total_experience: (profile.total_experience || 0) + sessionData.experience_gained,
        last_activity: new Date().toISOString(),
      });
    }

    return c.json({ success: true });
  } catch (e) {
    console.error('progress game-session error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { progress };
