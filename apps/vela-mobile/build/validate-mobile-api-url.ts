import type { Plugin } from 'vite';
import { loadEnv } from 'vite';

/**
 * Validate that `VITE_MOBILE_API_URL` is a present, valid absolute http(s) URL
 * with a hostname. Throws with a descriptive message otherwise.
 *
 * Extracted from the inline plugin that lived in `quasar.config.ts` so the
 * validation logic is unit-testable without shelling out to a Vite build. The
 * runtime mirror (`src/config/index.ts` `validateConfig`) covers the same
 * contract at app boot; this function covers it at build time, catching a
 * missing/malformed `.env.production` before the app ships rather than at
 * first launch in a native WebView.
 *
 * @param url The merged `VITE_MOBILE_API_URL` value Vite would inject.
 */
export function validateMobileApiUrl(url: string | undefined): void {
  if (!url || (typeof url === 'string' && url.trim() === '')) {
    throw new Error(
      'VITE_MOBILE_API_URL is missing. Vite loads .env, .env.local, ' +
        '.env.production, and .env.production.local (in that order, ' +
        'with existing process.env values winning). Set it in one of ' +
        'those, or export VITE_MOBILE_API_URL. Run ' +
        'packages/cdk/scripts/inject-env.ts after cdk:deploy to ' +
        'generate .env.production.',
    );
  }

  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      !parsed.hostname
    ) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error(
      `VITE_MOBILE_API_URL must be a valid absolute http(s) URL with a hostname, got: ${url}`,
    );
  }
}

/**
 * Vite plugin that validates `VITE_MOBILE_API_URL` at production build time.
 *
 * - Dev mode: no-op (the runtime `validateConfig` warns instead).
 * - `MOBILE_SKIP_ENV_VALIDATION=true`: bypass. Intended for CI pipelines that
 *   run `inject-env.ts` (or otherwise guarantee `.env.production`) before the
 *   build and therefore already exercise the validation path. Default:
 *   enforce, so a clean checkout without `.env.production` fails at build time
 *   rather than at app launch.
 *
 * `loadEnv` merges `.env`, `.env.local`, `.env.[mode]`, and `.env.[mode].local`
 * in precedence order (later files win), then gives existing `process.env`
 * values final priority — so a relative override in `.env.production.local`
 * would otherwise pass this check while `validateConfig()` crashes the native
 * app at boot. `loadEnv` expands against a `process.env` clone and does not
 * mutate the live env.
 *
 * @param rootDir The project root containing `.env*` files. Pass the
 *   `quasar.config.ts` directory (Vite resolves `.env` relative to this).
 */
export function validateMobileApiUrlPlugin(rootDir: string): Plugin {
  return {
    name: 'validate-mobile-api-url',
    config(_, { mode }) {
      if (mode !== 'production') return;
      if (process.env.MOBILE_SKIP_ENV_VALIDATION === 'true') return;

      const env = loadEnv(mode, rootDir, 'VITE_');
      validateMobileApiUrl(env.VITE_MOBILE_API_URL);
    },
  };
}
