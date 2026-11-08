import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  ExpectedPreferencesVersionSchema,
  normalizePreferences,
  preserveStoredLlm,
  PreferencesReadSchema,
  PreferencesSchema,
} from '../profile-preferences';
import type { Env } from '../types';
import { profiles as profilesDB, type Profile } from '../dynamodb';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { UserIdQuerySchema } from '../validation';

// Validation schemas
const UpdateProfileSchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  expected_preferences_version: ExpectedPreferencesVersionSchema,
  username: z.string().optional(),
  avatar_url: z.string().optional(),
  native_language: z.string().optional(),
  preferences: PreferencesSchema.optional(),
});

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
        const newProfile: Profile = {
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
        try {
          await profilesDB.create(newProfile);
          profile = newProfile;
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException')
            throw error;
          profile = await profilesDB.get(user_id);
          if (!profile) throw error;
        }
      }
      const rawPreferences = profile.preferences;
      const normalizedPreferences = normalizePreferences(rawPreferences);
      const parsedPreferences = PreferencesReadSchema.safeParse(normalizedPreferences);

      if (!parsedPreferences.success) {
        console.error('Invalid preferences data for user_id:', user_id);
        return c.json({ error: 'Invalid preferences data' }, 500);
      }

      // Return normalized preferences without persisting them on GET.
      profile.preferences = parsedPreferences.data;

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
      const { user_id, expected_preferences_version, ...updates } = profileData;

      // Authorization check: ensure client can only update their own profile
      if (user_id !== authenticatedUserId) {
        return c.json({ error: "Forbidden: Cannot update another user's profile" }, 403);
      }

      // Normalize preferences if they are being updated
      if (updates.preferences) {
        if (expected_preferences_version === undefined) {
          return c.json({ error: 'Reload your profile before saving preferences' }, 428);
        }
        updates.preferences = normalizePreferences(updates.preferences);

        // Validate the normalized preferences before persisting
        const parsedPreferences = PreferencesSchema.safeParse(updates.preferences);

        if (!parsedPreferences.success) {
          console.error('Invalid preferences data for user_id:', user_id, parsedPreferences.error);
          return c.json({ error: 'Invalid preferences data' }, 400);
        }

        updates.preferences = parsedPreferences.data;
        const existing = await profilesDB.get(user_id);
        preserveStoredLlm(updates.preferences as Record<string, unknown>, existing?.preferences);
      }

      // Add updated_at timestamp
      const timestampedUpdates = { ...updates, updated_at: new Date().toISOString() };
      const updatedProfile = updates.preferences
        ? await profilesDB.update(user_id, timestampedUpdates, expected_preferences_version)
        : await profilesDB.update(user_id, timestampedUpdates);

      if (updatedProfile?.preferences) {
        // The update already committed, so a malformed stored preference must
        // not turn this success response into an error. Sanitize when possible
        // and fall back to the committed record otherwise.
        const parsedPreferences = PreferencesReadSchema.safeParse(
          normalizePreferences(updatedProfile.preferences),
        );
        if (parsedPreferences.success) {
          updatedProfile.preferences = parsedPreferences.data;
        } else {
          console.error(
            'Committed preferences failed sanitization for user_id:',
            user_id,
            parsedPreferences.error,
          );
        }
      }
      return c.json({ success: true, profile: updatedProfile });
    } catch (e) {
      if (e instanceof Error && e.name === 'ConditionalCheckFailedException') {
        return c.json({ error: 'Preferences changed elsewhere' }, 409);
      }
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

        // Check if profile already exists (upsert pattern)
        const existingProfile = await profilesDB.get(user_id);

        if (existingProfile) {
          // Profile exists - claim the username if provided and still unset.
          // The claim is conditional so a username set between the read and
          // the write is never overwritten.
          if (username && !existingProfile.username) {
            await profilesDB.claimUsername(user_id, username);
          }
          return c.json({ success: true, message: 'Profile already exists' });
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

        try {
          await profilesDB.create(profile);
        } catch (error) {
          if (!(error instanceof Error) || error.name !== 'ConditionalCheckFailedException')
            throw error;
          // A concurrent request created the profile first (e.g. GET auto-create
          // with a null username). Preserve the supplied username when the
          // winning profile does not already carry one. The claim is a
          // conditional write so a username set after this re-read still wins.
          if (username) {
            const winner = await profilesDB.get(user_id);
            if (winner && !winner.username) {
              await profilesDB.claimUsername(user_id, username);
            }
          }
        }

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
