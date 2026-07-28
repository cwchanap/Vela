import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { expand } from 'dotenv-expand';

type VitePluginLike = {
  name: string;
  configResolved: (config: { mode: string }) => void;
};

const mobileBuildEnvKeys = [
  'VITE_MOBILE_API_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
] as const;

type MobileBuildEnvKey = (typeof mobileBuildEnvKeys)[number];
type MobileBuildEnv = Partial<Record<MobileBuildEnvKey, string>>;

export function loadMobileBuildEnv(
  mode: string,
  rootDir: string,
  processEnv: Record<string, string | undefined> = process.env,
): MobileBuildEnv {
  const parsed: Record<string, string> = {};
  const envFiles = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];

  for (const envFile of envFiles) {
    const envPath = resolve(rootDir, envFile);
    if (existsSync(envPath)) {
      Object.assign(parsed, parse(readFileSync(envPath)));
    }
  }

  const expandedProcessEnv = Object.fromEntries(
    Object.entries(processEnv).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const expanded = expand({ parsed, processEnv: expandedProcessEnv }).parsed ?? {};

  // Match Vite's precedence exactly: an existing process.env key wins even
  // when its value is empty, so validation reports it as missing instead of
  // silently falling back to a lower-precedence .env file.
  return Object.fromEntries(
    mobileBuildEnvKeys.map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(processEnv, key) ? processEnv[key] : expanded[key],
    ]),
  ) as MobileBuildEnv;
}

function isMissingEnvValue(value: string | undefined): boolean {
  return !value || value.trim() === '';
}

function containsWhitespace(value: string): boolean {
  return /\s/.test(value);
}

function isValidHostOnlyDomain(value: string): boolean {
  try {
    const url = new URL(`https://${value}`);
    return (
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname === '/' &&
      url.hostname.toLowerCase() === value.toLowerCase()
    );
  } catch {
    return false;
  }
}

function hasMatchingUserPoolRegion(userPoolId: string, region: string): boolean {
  const separatorIndex = userPoolId.indexOf('_');
  return separatorIndex > 0 && userPoolId.slice(0, separatorIndex) === region;
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
 * The build-time and runtime contracts must agree in production. The runtime
 * `validateConfig` rejects `http:` when `PROD` is true (ATS enforcement
 * depends on this — a Release build must not load over HTTP). This function
 * therefore takes a `requireHttps` flag that the production-only Vite plugin
 * sets to `true`; dev-mode callers leave it unset so local/simulator HTTP
 * URLs continue to pass.
 *
 * @param url The merged `VITE_MOBILE_API_URL` value Vite would inject.
 * @param options.requireHttps When true, reject `http:` URLs. Set by the
 *   production build plugin so a misconfigured HTTP release fails at build
 *   time instead of producing a distributable that crashes at boot.
 */
export function validateMobileApiUrl(
  url: string | undefined,
  options: { requireHttps?: boolean } = {},
): void {
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
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      throw new Error('invalid');
    }
    if (options.requireHttps && parsed.protocol === 'http:') {
      throw new Error(`VITE_MOBILE_API_URL must be https: in production, got: ${url}`);
    }
  } catch (err) {
    // Re-throw the explicit HTTPS-requirement message verbatim; only wrap
    // the generic URL-parse/shape failures.
    if (err instanceof Error && err.message.startsWith('VITE_MOBILE_API_URL must be https:')) {
      throw err;
    }
    throw new Error(
      `VITE_MOBILE_API_URL must be a valid absolute http(s) URL with a hostname, got: ${url}`,
    );
  }
}

/**
 * Validate the full production build contract for mobile OAuth. Keep this in
 * sync with `src/config/index.ts` so deployment-time mistakes fail before an
 * iOS bundle is produced rather than at application boot.
 */
export function validateMobileBuildEnv(env: MobileBuildEnv): void {
  validateMobileApiUrl(env.VITE_MOBILE_API_URL, { requireHttps: true });

  const requiredCognitoKeys = mobileBuildEnvKeys.slice(1);
  for (const key of requiredCognitoKeys) {
    if (isMissingEnvValue(env[key])) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const userPoolId = env.VITE_COGNITO_USER_POOL_ID!;
  const mobileClientId = env.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID!;
  const oauthDomain = env.VITE_COGNITO_OAUTH_DOMAIN!;
  const region = env.VITE_AWS_REGION!;

  for (const [key, value] of [
    ['VITE_COGNITO_USER_POOL_ID', userPoolId],
    ['VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID', mobileClientId],
    ['VITE_AWS_REGION', region],
  ] as const) {
    if (containsWhitespace(value)) {
      throw new Error(`${key} must not contain whitespace`);
    }
  }

  if (!isValidHostOnlyDomain(oauthDomain)) {
    throw new Error('VITE_COGNITO_OAUTH_DOMAIN must be a valid host-only domain');
  }

  if (!hasMatchingUserPoolRegion(userPoolId, region)) {
    throw new Error(
      'VITE_COGNITO_USER_POOL_ID must start with the configured VITE_AWS_REGION followed by an underscore',
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
    configResolved({ mode }) {
      if (mode !== 'production') return;
      if (process.env.MOBILE_SKIP_ENV_VALIDATION === 'true') return;

      validateMobileBuildEnv(loadMobileBuildEnv(mode, rootDir));
    },
  };
}
