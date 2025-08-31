import { supabase } from './supabase';

/**
 * Test utility for local Supabase development
 */
export class SupabaseTest {
  /**
   * Test basic connection to Supabase
   */
  static async testConnection(): Promise<boolean> {
    try {
      const { error } = await supabase.from('profiles').select('count').limit(1);

      if (error) {
        console.error('❌ Supabase connection failed:', error.message);
        return false;
      }

      console.log('✅ Supabase connection successful');
      return true;
    } catch (error) {
      console.error('❌ Supabase connection error:', error);
      return false;
    }
  }

  /**
   * Get current Supabase configuration
   */
  static getConfig() {
    return {
      url: import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY
        ? '[REDACTED]'
        : 'Using local development key',
      isLocal: !import.meta.env.VITE_SUPABASE_URL,
    };
  }

  /**
   * Display connection info in console
   */
  static displayConnectionInfo() {
    const config = this.getConfig();
    console.log('📊 Supabase Configuration:', config);
    console.log('🔗 Studio URL: http://127.0.0.1:54323');
    console.log('🔗 API URL:', config.url);
  }
}

/**
 * Quick connection test function
 */
export async function testSupabaseConnection() {
  console.log('🧪 Testing Supabase connection...');

  SupabaseTest.displayConnectionInfo();

  const isConnected = await SupabaseTest.testConnection();

  if (isConnected) {
    console.log('🎉 Ready to use local Supabase for development!');
  } else {
    console.log('⚠️  Make sure your local Supabase is running with: supabase start');
  }

  return isConnected;
}
