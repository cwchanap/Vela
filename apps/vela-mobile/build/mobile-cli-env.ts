import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { isCI } from 'ci-info';
import { mobileBuildEnvKeys, type MobileBuildEnv } from './validate-mobile-api-url';

type EnvMap = Record<string, string | undefined>;

/**
 * Whether `.env.local` is skipped. Quasar's `getAppEnv` decides this with
 * ci-info's `isCI` evaluated against the real `process.env`, so this reader
 * must agree with it:
 *
 * - For the real `process.env` it uses the same `isCI` constant, including
 *   ci-info's vendor detection. `CI=0` is CI; only an explicit `CI=false`
 *   opts out.
 * - For an injected env (tests, `deps.env`) vendor detection cannot run, so
 *   it applies ci-info's generic rule: `CI !== 'false'` and any of the
 *   generic CI variables set to a non-empty value. This is ci-info's own
 *   `isCI` expression minus the vendor-specific part.
 */
export function isCiEnvironment(processEnv: EnvMap): boolean {
  if (processEnv === process.env) return isCI;
  return (
    processEnv.CI !== 'false' &&
    [
      'BUILD_ID',
      'BUILD_NUMBER',
      'CI',
      'CI_APP_ID',
      'CI_BUILD_ID',
      'CI_BUILD_NUMBER',
      'CI_NAME',
      'CONTINUOUS_INTEGRATION',
      'RUN_ID',
    ].some((key) => Boolean(processEnv[key]))
  );
}

/**
 * Reads the plain `KEY=VALUE` files available to the standalone mobile CLIs
 * (`verify:deployed-config`, `verify:m1-foundation`). Those commands run
 * outside Quasar, so they never receive a resolved Vite `config.define`.
 *
 * This reader is deliberately minimal: `packages/cdk/scripts/inject-env.ts`
 * writes literal values (no `$VAR` expansion), and the Quasar-resolved define
 * remains the single source of truth for compiled bundle values. Do not use
 * this helper for validation inside the build or for the iOS version.
 *
 * Precedence: `.env` → `.env.local` (outside CI only, see
 * {@link isCiEnvironment}) → `.env.production` → `.env.production.local`,
 * then any direct process override wins, including an explicitly empty one.
 * Keep the file list in sync with `build.env.file` in `quasar.config.ts`.
 */
export function loadMobileCliEnv(
  rootDir: string,
  processEnv: EnvMap = process.env,
): MobileBuildEnv {
  const fileEnv: Record<string, string> = {};
  for (const file of [
    '.env',
    ...(isCiEnvironment(processEnv) ? [] : ['.env.local']),
    '.env.production',
    '.env.production.local',
  ]) {
    const path = resolve(rootDir, file);
    if (existsSync(path)) Object.assign(fileEnv, parseEnv(readFileSync(path, 'utf8')));
  }

  return Object.fromEntries(
    mobileBuildEnvKeys.map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(processEnv, key) ? processEnv[key] : fileEnv[key],
    ]),
  ) as MobileBuildEnv;
}
