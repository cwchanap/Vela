import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env } from '../types';

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

  /* ========================
   * Supabase implementation
   * ======================== */

  async function getSupabaseClient(supabaseUrl?: string, supabaseAnonKey?: string) {
    console.log('Supabase config check:', {
      supabaseUrl: supabaseUrl ? 'present' : 'missing',
      supabaseAnonKey: supabaseAnonKey ? 'present' : 'missing',
      url: supabaseUrl,
    });

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase configuration');
    }

    // Check for dummy values that indicate Supabase is disabled
    if (supabaseUrl.includes('dummy') || supabaseAnonKey.includes('dummy')) {
      throw new Error('Supabase is disabled in development environment');
    }

    console.log('Creating Supabase client with URL:', supabaseUrl);
    const client = createClient(supabaseUrl, supabaseAnonKey);
    console.log('Supabase client created successfully');
    return client;
  }

  // Mock profile data for development when Supabase is disabled
  const mockProfiles: Record<string, any> = {};

  function getMockProfile(userId: string) {
    return (
      mockProfiles[userId] || {
        id: userId,
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
      }
    );
  }

  /* ============
   * Routes
   * ============ */

  profiles.get('/', zValidator('query', UserIdQuerySchema), async (c) => {
    try {
      const { user_id } = c.req.valid('query');
      console.log('Fetching profile for user_id:', user_id);

      try {
        const supabase = await getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
        console.log('Supabase client obtained, executing query...');

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user_id)
          .single();

        console.log('Supabase query result:', {
          hasData: !!profile,
          hasError: !!error,
          errorCode: error?.code,
          errorMessage: error?.message,
        });

        if (error) {
          if (error.code === 'PGRST116') {
            // Profile not found, so create it
            console.log('Profile not found for user_id, creating new one:', user_id);
            const { data: newProfile, error: createError } = await supabase
              .from('profiles')
              .insert({ id: user_id, native_language: 'en' })
              .select()
              .single();

            if (createError) {
              throw new Error(`Failed to create profile: ${createError.message}`);
            }
            return c.json({ profile: newProfile });
          }
          throw new Error(`Failed to fetch profile: ${error.message}`);
        }

        return c.json({ profile });
      } catch (supabaseError: any) {
        // If Supabase is disabled, return mock data
        if (supabaseError.message?.includes('Supabase is disabled')) {
          console.log('Using mock profile data for development');
          const profile = getMockProfile(user_id);
          return c.json({ profile });
        }
        throw supabaseError;
      }
    } catch (e) {
      console.error('profiles get error', e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      return c.json({ error: msg }, 500);
    }
  });

  profiles.put('/update', zValidator('json', UpdateProfileSchema), async (c) => {
    try {
      const profileData = c.req.valid('json');

      try {
        const supabase = await getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

        const { error } = await supabase
          .from('profiles')
          .update({
            username: profileData.username,
            avatar_url: profileData.avatar_url,
            native_language: profileData.native_language,
            preferences: profileData.preferences,
            updated_at: new Date().toISOString(),
          })
          .eq('id', profileData.user_id);

        if (error) {
          throw new Error(`Failed to update profile: ${error.message}`);
        }

        return c.json({ success: true });
      } catch (supabaseError: any) {
        // If Supabase is disabled, update mock data
        if (supabaseError.message?.includes('Supabase is disabled')) {
          console.log('Updating mock profile data for development');
          const existingProfile = getMockProfile(profileData.user_id);
          mockProfiles[profileData.user_id] = {
            ...existingProfile,
            ...profileData,
            updated_at: new Date().toISOString(),
          };
          return c.json({ success: true });
        }
        throw supabaseError;
      }
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

        try {
          const supabase = await getSupabaseClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

          const { error } = await supabase.from('profiles').insert({
            id: user_id,
            email: email || null,
            username: username || null,
            native_language: 'en',
            current_level: 1,
            total_experience: 0,
            learning_streak: 0,
            preferences: {},
          });

          if (error) {
            throw new Error(`Failed to create profile: ${error.message}`);
          }

          return c.json({ success: true });
        } catch (supabaseError: any) {
          // If Supabase is disabled, create mock profile
          if (supabaseError.message?.includes('Supabase is disabled')) {
            console.log('Creating mock profile data for development');
            mockProfiles[user_id] = {
              id: user_id,
              email: email || null,
              username: username || null,
              avatar_url: null,
              native_language: 'en',
              current_level: 1,
              total_experience: 0,
              learning_streak: 0,
              preferences: {},
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            return c.json({ success: true });
          }
          throw supabaseError;
        }
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
