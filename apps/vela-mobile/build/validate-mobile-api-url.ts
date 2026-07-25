import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { expand } from 'dotenv-expand';

type VitePluginLike = {
  name: string;
  config: (config: unknown, env: { mode: string }) => void;
};

function loadMobileApiUrl(mode: string, rootDir: string): string | undefined {
  const parsed: Record<string, string> = {};
  const envFiles = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];

  for (const envFile of envFiles) {
    const envPath = resolve(rootDir, envFile);
    if (existsSync(envPath)) {
      Object.assign(parsed, parse(readFileSync(envPath)));
    }
  }

  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const expanded = expand({ parsed, processEnv }).parsed ?? {};

  // Match Vite's precedence exactly: an existing process.env key wins even
  // when its value is empty, so validation reports it as missing instead of
  // silently falling back to a lower-precedence .env file.
  if (Object.prototype.hasOwnProperty.call(process.env, 'VITE_MOBILE_API_URL')) {
    return process.env.VITE_MOBILE_API_URL;
  }

  return expanded.VITE_MOBILE_API_URL;
}

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
 * Vite-compatible plugin that validates `VITE_MOBILE_API_URL` at production
 * build time without importing Vite during Quasar's postinstall preparation.
 *
 * - Dev mode: no-op (the runtime `validateConfig` warns instead).
 * - `MOBILE_SKIP_ENV_VALIDATION=true`: bypass. Intended for CI pipelines that
 *   run `inject-env.ts` (or otherwise guarantee `.env.production`) before the
 *   build and therefore already exercise the validation path. Default:
 *   enforce, so a clean checkout without `.env.production` fails at build time
 *   rather than at app launch.
 *
 * The loader mirrors Vite's `.env` file order and process.env precedence using
 * dependencies already declared by `@vela/mobile`. Keeping this module free of
 * direct Vite imports is required because Quasar evaluates it from the mobile
 * workspace's postinstall hook before the monorepo install has completed.
 *
 * @param rootDir The project root containing `.env*` files. Pass the
 *   `quasar.config.ts` directory (Vite resolves `.env` relative to this).
 */
export function validateMobileApiUrlPlugin(rootDir: string): VitePluginLike {
  return {
    name: 'validate-mobile-api-url',
    config(_, { mode }) {
      if (mode !== 'production') return;
      if (process.env.MOBILE_SKIP_ENV_VALIDATION === 'true') return;

      validateMobileApiUrl(loadMobileApiUrl(mode, rootDir));
    },
  };
}
