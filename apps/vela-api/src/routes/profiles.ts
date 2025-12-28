import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { profiles as profilesDB } from '../dynamodb';
import { DEFAULT_DAILY_LESSON_GOAL, DEFAULT_LESSON_DURATION_MINUTES } from '@vela/common';

const PreferencesSchema = z
  .object({
    dailyGoal: z.coerce.number().int().min(1).max(1440).optional(),
    dailyLessonGoal: z.coerce.number().int().min(1).max(50).optional(),
    lessonDurationMinutes: z.coerce.number().int().min(1).max(120).optional(),
    difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
    notifications: z.boolean().optional(),
    todayStudyTime: z.coerce.number().optional(),
  })
  .strict();

// Validation schemas
const UserIdQuerySchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
});

const UpdateProfileSchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  username: z.string().optional(),
  avatar_url: z.string().optional(),
  native_language: z.string().optional(),
  preferences: PreferencesSchema.optional(),
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeRequiredPreferenceNumber = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  fieldName: string,
) => {
  const parsedValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsedValue)) {
    console.warn(`Invalid ${fieldName}: ${value}. Using fallback: ${fallback}`);
    return fallback;
  }
  const normalized = Math.trunc(parsedValue);
  if (normalized < min || normalized > max) {
    console.warn(`Out of range ${fieldName}: ${normalized}. Using fallback: ${fallback}`);
    return fallback;
  }
  return normalized;
};

const normalizePreferences = (preferences: unknown) => {
  const base = isPlainObject(preferences) ? preferences : {};
  return {
    ...base,
    dailyLessonGoal: normalizeRequiredPreferenceNumber(
      base.dailyLessonGoal,
      DEFAULT_DAILY_LESSON_GOAL,
      1,
      50,
      'dailyLessonGoal',
    ),
    lessonDurationMinutes: normalizeRequiredPreferenceNumber(
      base.lessonDurationMinutes,
      DEFAULT_LESSON_DURATION_MINUTES,
      1,
      120,
      'lessonDurationMinutes',
    ),
  };
};

const createProfilesRoute = (env: Env) => {
  console.debug('Creating profiles route with env:', env ? 'provided' : 'not provided');
  const profiles = new Hono<{ Bindings: Env }>();

  /* ============
   * Routes
   * ============ */

  profiles.get('/', zValidator('query', UserIdQuerySchema), async (c) => {
    try {
      const { user_id } = c.req.valid('query');
      console.log('Fetching profile for user_id:', user_id);

      // Try to get existing profile
      let profile = await profilesDB.get(user_id);

      // If profile doesn't exist, create it
      if (!profile) {
        console.log('Profile not found for user_id, creating new one:', user_id);
        const defaultPreferences = normalizePreferences({});
        profile = {
          user_id,
          email: null,
          username: null,
          avatar_url: null,
          native_language: 'en',
          current_level: 1,
          total_experience: 0,
          learning_streak: 0,
          preferences: defaultPreferences,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await profilesDB.create(profile);
      } else {
        const rawPreferences = profile.preferences;
        const normalizedPreferences = normalizePreferences(rawPreferences);
        const parsedPreferences = PreferencesSchema.safeParse(normalizedPreferences);

        if (!parsedPreferences.success) {
          console.error('Invalid preferences data for user_id:', user_id);
          return c.json({ error: 'Invalid preferences data' }, 500);
        }

        // Return normalized preferences in-memory without persisting to DB
        // to ensure GET is idempotent.
        profile.preferences = parsedPreferences.data;
      }

      return c.json({ profile });
    } catch (e) {
      console.error('profiles get error', e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ error: msg }, 500);
    }
  });

  profiles.put('/update', zValidator('json', UpdateProfileSchema), async (c) => {
    try {
      const profileData = c.req.valid('json');
      const { user_id, ...updates } = profileData;

      // Normalize preferences if they are being updated
      if (updates.preferences) {
        updates.preferences = normalizePreferences(updates.preferences);
      }

      // Add updated_at timestamp
      const updatedProfile = await profilesDB.update(user_id, {
        ...updates,
        updated_at: new Date().toISOString(),
      });

      return c.json({ success: true, profile: updatedProfile });
    } catch (e) {
      console.error('profiles update error', e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ error: msg }, 500);
    }
  });

  profiles.post(
    '/create',
    zValidator(
      'json',
      z.object({
        user_id: z.string().min(1, 'user_id is required'),
        email: z.string().email().optional(),
        username: z.string().optional(),
      }),
    ),
    async (c) => {
      try {
        const { user_id, email, username } = c.req.valid('json');

        const defaultPreferences = normalizePreferences({});
        const profile = {
          user_id,
          email: email || null,
          username: username || null,
          native_language: 'en',
          current_level: 1,
          total_experience: 0,
          learning_streak: 0,
          preferences: defaultPreferences,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        await profilesDB.create(profile);

        return c.json({ success: true });
      } catch (e) {
        console.error('profiles create error', e);
        const msg = e instanceof Error ? e.message : 'Unknown error';
        return c.json({ error: msg }, 500);
      }
    },
  );

  return profiles;
};

export { createProfilesRoute as profiles };
