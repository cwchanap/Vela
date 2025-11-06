import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { profiles as profilesDB } from '../dynamodb';

// Validation schemas
const UserIdQuerySchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
});

const UpdateProfileSchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  username: z.string().optional(),
  avatar_url: z.string().optional(),
  native_language: z.string().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

const createProfilesRoute = (env: Env) => {
  console.debug('Creating profiles route with env:', env ? 'provided' : 'not provided');
  const profiles = new Hono<{ Bindings: Env }>();

  // Custom CORS handler
  profiles.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'content-type');

    if (c.req.method === 'OPTIONS') {
      return c.text('', 200);
    }

    await next();
  });

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
        profile = {
          user_id,
          email: null,
          username: null,
          avatar_url: null,
          native_language: 'en',
          current_level: 1,
          total_experience: 0,
          learning_streak: 0,
          preferences: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await profilesDB.create(profile);
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

        const profile = {
          user_id,
          email: email || null,
          username: username || null,
          native_language: 'en',
          current_level: 1,
          total_experience: 0,
          learning_streak: 0,
          preferences: {},
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
