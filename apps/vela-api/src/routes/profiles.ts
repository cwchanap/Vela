import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { profiles as profilesDB } from '../dynamodb';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { UserIdQuerySchema } from '../validation';

const DEFAULT_DAILY_LESSON_GOAL = 5;
const DEFAULT_LESSON_DURATION_MINUTES = 6;
const DEFAULT_DAILY_GOAL = 30;

const PreferencesShape = {
  dailyGoal: z.coerce.number().int().min(1).max(1440).optional(),
  dailyLessonGoal: z.coerce.number().int().min(1).max(50).optional(),
  lessonDurationMinutes: z.coerce.number().int().min(1).max(120).optional(),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).optional(),
  notifications: z.boolean().optional(),
  todayStudyTime: z.coerce.number().optional(),
} satisfies z.ZodRawShape;

// Strip unknown keys on writes (PUT) to prevent arbitrary/unexpected keys being stored
// while still accepting legacy data with extra fields.
const PreferencesSchema = z.object(PreferencesShape).strip();

// Lenient on reads (GET) to prevent legacy keys in DynamoDB from causing 500s.
// This strips unknown keys while still validating known keys.
const PreferencesReadSchema = z.object(PreferencesShape).strip();

// Validation schemas
const UpdateProfileSchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  username: z.string().optional(),
  avatar_url: z.string().optional(),
  native_language: z.string().optional(),
  preferences: PreferencesSchema.optional(),
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates and normalizes a numeric preference value.
 * Ensures the value is a finite number within the specified range [min, max].
 * If invalid or out of range, returns the fallback value.
 */
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
    dailyGoal: normalizeRequiredPreferenceNumber(
      base.dailyGoal,
      DEFAULT_DAILY_GOAL,
      1,
      1440,
      'dailyGoal',
    ),
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
    todayStudyTime: normalizeRequiredPreferenceNumber(
      base.todayStudyTime,
      0,
      0,
      1440, // Max minutes in a day
      'todayStudyTime',
    ),
  };
};

const createProfilesRoute = (env: Env) => {
  console.debug('Creating profiles route with env:', env ? 'provided' : 'not provided');
  const profiles = new Hono<{ Bindings: Env } & AuthContext>();
  profiles.use('*', requireAuth);

  /* ============
   * Routes
   * ============ */

  profiles.get('/', zValidator('query', UserIdQuerySchema), async (c) => {
    try {
      // Use authenticated user's ID from context instead of trusting client-supplied user_id
      const authenticatedUserId = c.get('userId');
      const { user_id } = c.req.valid('query');

      // Authorization check: ensure client can only access their own profile
      if (user_id !== authenticatedUserId) {
        return c.json({ error: "Forbidden: Cannot access another user's profile" }, 403);
      }

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
        const parsedPreferences = PreferencesReadSchema.safeParse(normalizedPreferences);

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
      // Use authenticated user's ID from context instead of trusting client-supplied user_id
      const authenticatedUserId = c.get('userId');
      const profileData = c.req.valid('json');
      const { user_id, ...updates } = profileData;

      // Authorization check: ensure client can only update their own profile
      if (user_id !== authenticatedUserId) {
        return c.json({ error: "Forbidden: Cannot update another user's profile" }, 403);
      }

      // Normalize preferences if they are being updated
      if (updates.preferences) {
        updates.preferences = normalizePreferences(updates.preferences);

        // Validate the normalized preferences before persisting
        const parsedPreferences = PreferencesSchema.safeParse(updates.preferences);

        if (!parsedPreferences.success) {
          console.error('Invalid preferences data for user_id:', user_id, parsedPreferences.error);
          return c.json({ error: 'Invalid preferences data' }, 400);
        }

        updates.preferences = parsedPreferences.data;
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
        // Use authenticated user's ID from context instead of trusting client-supplied user_id
        const authenticatedUserId = c.get('userId');
        const { user_id, email, username } = c.req.valid('json');

        // Authorization check: ensure client can only create their own profile
        if (user_id !== authenticatedUserId) {
          return c.json({ error: 'Forbidden: Cannot create profile for another user' }, 403);
        }

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
