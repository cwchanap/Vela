import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  containsWhitespace,
  hasMatchingUserPoolRegion,
  isValidHostOnlyDomain,
} from '../src/auth/config-validators';

const IMPORT_META_ENV_PREFIX = 'import.meta.env.';
const APP_VERSION_DEFINE_KEY = `${IMPORT_META_ENV_PREFIX}VITE_APP_VERSION`;

type ResolvedMobileConfigLike = {
  mode: string;
  define: Record<string, unknown>;
};

type VitePluginLike = {
  name: string;
  configResolved: (config: ResolvedMobileConfigLike) => void;
};

export const mobileBuildEnvKeys = [
  'VITE_MOBILE_API_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
] as const;

type MobileBuildEnvKey = (typeof mobileBuildEnvKeys)[number];
export type MobileBuildEnv = Partial<Record<MobileBuildEnvKey, string>>;

// Explicit presence-checked Cognito keys. Decoupled from `mobileBuildEnvKeys`
// ordering so reordering the build-env list cannot silently change which keys
// are validated as required.
const requiredCognitoKeys = [
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
] as const satisfies readonly MobileBuildEnvKey[];

type DecodedDefineEntry =
  | { kind: 'string'; value: string }
  | { kind: 'non-string'; literal: string }
  | { kind: 'malformed'; literal: string }
  | { kind: 'missing' };

/**
 * Decode one required mobile client value from `config.define`. Quasar v3
 * stores JSON-encoded strings (`"https://…"`), raw `true`/`false`, raw
 * numeric literals, and raw `null`. Only a resolved string is valid for these
 * required string settings: coercing a boolean/number would let the build
 * guard pass a configuration the client bundle stores with a non-string type.
 */
function decodeRequiredStringDefine(value: unknown): DecodedDefineEntry {
  if (value === undefined) return { kind: 'missing' };
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return { kind: 'non-string', literal: String(value) };
  }
  if (typeof value !== 'string') return { kind: 'missing' };

  const trimmed = value.trim();
  if (trimmed === '') return { kind: 'string', value: '' };
  // Quasar only emits raw literals for booleans/numbers/null; ordinary
  // strings are JSON-encoded. Any unquoted value is therefore not a string.
  if (!trimmed.startsWith('"')) return { kind: 'non-string', literal: trimmed };

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'string'
      ? { kind: 'string', value: parsed }
      : { kind: 'non-string', literal: trimmed };
  } catch {
    return { kind: 'malformed', literal: trimmed };
  }
}

/**
 * Decode the resolved app version. This preserves the existing version
 * contract: string literals are used, raw boolean/number literals are
 * stringified for the semver check, and `null`/absent falls through to
 * `package.json.version`.
 */
function decodeVersionDefine(value: unknown): string | undefined {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  if (trimmed === 'null') return undefined;
  if (!trimmed.startsWith('"')) return trimmed;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the mobile client values from the Quasar-resolved Vite `define` map.
 * This is exactly what the client bundle receives, so build-time validation
 * and native version sync cannot drift from the compiled app. Non-string
 * resolved literals are rejected here, at the adapter boundary, before the
 * pure string-only validator runs.
 */
export function mobileEnvFromDefine(
  define: Record<string, unknown> | undefined,
): MobileBuildEnv {
  return Object.fromEntries(
    mobileBuildEnvKeys.map((key) => {
      const decoded = decodeRequiredStringDefine(define?.[`${IMPORT_META_ENV_PREFIX}${key}`]);
      if (decoded.kind === 'non-string') {
        throw new Error(
          `${key} must resolve to a string in the client bundle, but Quasar resolved ${decoded.literal}. Set it to a plain string value in the build environment.`,
        );
      }
      if (decoded.kind === 'malformed') {
        throw new Error(
          `${key} resolved to a malformed quoted literal in the client bundle: ${decoded.literal}. Check the value for stray quotes or unescaped characters in the build environment.`,
        );
      }
      return [key, decoded.kind === 'string' ? decoded.value : undefined];
    }),
  ) as MobileBuildEnv;
}

function isMissingEnvValue(value: string | undefined): boolean {
  return !value || value.trim() === '';
}

/**
 * Validate that `VITE_MOBILE_API_URL` is a present, valid absolute http(s) URL
 * with a hostname. Throws with a descriptive message otherwise.
 *
 * The runtime mirror (`src/config/index.ts` `validateConfig`) covers the same
 * contract at app boot; this function covers it at build time, catching a
 * missing/malformed `.env.production` before the app ships rather than at
 * first launch in a native WebView.
 *
 * The build-time and runtime contracts must agree in production. The runtime
 * `validateConfig` rejects `http:` when `PROD` is true (ATS enforcement
 * depends on this — a Release build must not load over HTTP). This function
 * therefore takes a `requireHttps` flag that the production-only plugin sets
 * to `true`; dev-mode callers leave it unset so local/simulator HTTP URLs
 * continue to pass.
 *
 * @param url The Quasar-resolved `VITE_MOBILE_API_URL` value.
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
      'VITE_MOBILE_API_URL is missing. Set it in apps/vela-mobile/.env.production ' +
        'or export VITE_MOBILE_API_URL before building. Run ' +
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
 * Strips semver prerelease (`-x.y.z…`) and build metadata (`+x.y.z…`) from a
 * version string, returning the `major.minor.patch` prefix. iOS
 * `MARKETING_VERSION` (CFBundleShortVersionString) only accepts three numeric
 * dot segments — Apple rejects prerelease/build suffixes — so any resolved
 * version carrying them must be reduced before being written to the pbxproj.
 */
function stripSemverMetadata(version: string): string {
  const buildIdx = version.indexOf('+');
  const withoutBuild = buildIdx === -1 ? version : version.slice(0, buildIdx);
  const preIdx = withoutBuild.indexOf('-');
  return preIdx === -1 ? withoutBuild : withoutBuild.slice(0, preIdx);
}

/**
 * Resolve the native marketing version from the Quasar-resolved client
 * `VITE_APP_VERSION` when it is nonempty, otherwise the mobile package
 * version. Returns three numeric segments or throws.
 */
function resolveMarketingVersion(
  rootDir: string,
  define: Record<string, unknown> | undefined,
): string {
  const defineVersion = decodeVersionDefine(define?.[APP_VERSION_DEFINE_KEY]);
  const packageVersion = JSON.parse(
    readFileSync(resolve(rootDir, 'package.json'), 'utf8'),
  ).version as string | undefined;
  const version =
    defineVersion !== undefined && defineVersion.trim() !== ''
      ? defineVersion
      : (packageVersion ?? '');

  const marketingVersion = stripSemverMetadata(version);
  if (!marketingVersion || !/^\d+\.\d+\.\d+$/.test(marketingVersion)) {
    throw new Error(
      `Resolved version is missing or not semver-like: "${version}"` +
        ` (resolved define=${defineVersion ?? '<unset>'}` +
        `, package.json.version=${packageVersion ?? '<unset>'})`,
    );
  }
  return marketingVersion;
}

/**
 * Sync `MARKETING_VERSION` in the committed Xcode project from the resolved
 * build define. Only Capacitor builds call this; SPA builds never touch native
 * metadata. The write is skipped when the file already carries the value.
 */
function syncCapacitorMarketingVersion(
  rootDir: string,
  define: Record<string, unknown> | undefined,
): void {
  const marketingVersion = resolveMarketingVersion(rootDir, define);
  const pbxprojPath = resolve(rootDir, 'src-capacitor/ios/App/App.xcodeproj/project.pbxproj');
  const original = readFileSync(pbxprojPath, 'utf8');
  const pattern = /MARKETING_VERSION = [^;]+;/g;
  const matches = original.match(pattern);
  if (!matches) {
    throw new Error(`No MARKETING_VERSION entries found in ${pbxprojPath}`);
  }

  const updated = original.replace(pattern, `MARKETING_VERSION = ${marketingVersion};`);
  if (updated === original) {
    console.info(`iOS MARKETING_VERSION already at ${marketingVersion}; no change.`);
    return;
  }

  writeFileSync(pbxprojPath, updated);
  console.info(
    `Synced iOS MARKETING_VERSION -> ${marketingVersion} (${matches.length} entries in project.pbxproj).`,
  );
}

/**
 * Quasar/Vite plugin that enforces the production mobile env contract and,
 * for Capacitor builds, keeps the native MARKETING_VERSION in sync. It reads
 * the resolved `config.define` values in `configResolved` — the same literals
 * the client bundle receives — so validation cannot drift from the app and
 * no separate dotenv parser is needed.
 *
 * - Validation: production mode only. `MOBILE_SKIP_ENV_VALIDATION=true`
 *   bypasses it for pipelines that already guarantee the configuration.
 * - Native version sync: Capacitor mode only, in development and production,
 *   independent of the validation bypass.
 */
export function validateMobileApiUrlPlugin(options: {
  rootDir: string;
  isCapacitor: boolean;
}): VitePluginLike {
  return {
    name: 'validate-mobile-api-url',
    configResolved(config) {
      // Validate first: a misconfigured build must fail before it edits the
      // committed Xcode project.
      if (config.mode === 'production' && process.env.MOBILE_SKIP_ENV_VALIDATION !== 'true') {
        validateMobileBuildEnv(mobileEnvFromDefine(config.define));
      }
      if (options.isCapacitor) {
        syncCapacitorMarketingVersion(options.rootDir, config.define);
      }
    },
  };
}
