import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { mobileBuildEnvKeys, type MobileBuildEnv } from './validate-mobile-api-url';

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
 * Precedence: `.env` → `.env.local` (outside CI only) → `.env.production`,
 * then any direct process override wins, including an explicitly empty one.
 */
export function loadMobileCliEnv(
  rootDir: string,
  processEnv: Record<string, string | undefined> = process.env,
): MobileBuildEnv {
  const ciValue = processEnv.CI;
  const isCi =
    typeof ciValue === 'string' && ciValue !== '' && ciValue !== '0' && ciValue !== 'false';

  const fileEnv: Record<string, string> = {};
  for (const file of ['.env', ...(isCi ? [] : ['.env.local']), '.env.production']) {
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
