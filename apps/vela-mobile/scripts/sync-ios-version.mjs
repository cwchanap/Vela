// Syncs the iOS native marketing version (MARKETING_VERSION in project.pbxproj)
// so iOS metadata and the Home page report the same version. The Home page
// reads `import.meta.env.VITE_APP_VERSION`, which Vite populates from the .env
// files it loads for the active mode (`.env`, `.env.local`, `.env.[mode]`,
// `.env.[mode].local`). This script resolves the version with the same
// precedence Vite's `loadEnv` uses, then falls back to package.json "version"
// — so the UI and native bundle never drift when the version is set via a
// mode-specific file such as `.env.production`. Run via
// `bun run sync:ios-version` (wired into every Capacitor build/dev path).
// Pass `--mode=development` for dev runs so the same file set as Vite is loaded.
//
// Vite's `loadEnv` gives existing `process.env` values highest priority — they
// are NOT overridden by .env files. We mirror that: `process.env.VITE_APP_VERSION`
// is checked first, then the .env files for the active mode, then package.json.
// Bun auto-loads `.env` into `process.env` before this script runs, which is
// consistent with Vite's behavior — Vite also sees the Bun-loaded `.env` value
// in `process.env` and gives it precedence over `.env.production`. File
// resolution handles the case where no `.env` defines VITE_APP_VERSION and no
// shell export sets it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse as dotEnvParse } from 'dotenv';
import { expand as dotEnvExpand } from 'dotenv-expand';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = resolve(root, 'package.json');
const pbxprojPath = resolve(
  root,
  'src-capacitor/ios/App/App.xcodeproj/project.pbxproj',
);

// Vite's `mode` determines which mode-specific env files are loaded
// (`development` for `quasar dev`, `production` for `quasar build`). Default to
// `production` since iOS MARKETING_VERSION matters most for release builds.
const argvMode = parseArg(process.argv.slice(2), 'mode');
const mode = argvMode || 'production';

const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
// Resolve `VITE_APP_VERSION` with the same precedence Vite's `loadEnv` uses:
// `process.env.VITE_APP_VERSION` first (shell export or Bun-loaded `.env`),
// then the .env files Vite loads for the active mode (later files override
// earlier), then package.json "version" as the final fallback.
const processEnvVersion = process.env.VITE_APP_VERSION;
const fileEnvVersion = resolveFileEnvVersion(root, mode);
const version = processEnvVersion || fileEnvVersion || pkgVersion;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Resolved version is missing or not semver-like: "${version}"` +
      ` (processEnvVersion=${processEnvVersion ?? '<unset>'}` +
      `, fileEnvVersion=${fileEnvVersion ?? '<unset>'}` +
      `, package.json.version=${pkgVersion ?? '<unset>'})`,
  );
}

const original = readFileSync(pbxprojPath, 'utf8');
// Matches `MARKETING_VERSION = <any-value>;` (target-level Debug + Release).
const pattern = /MARKETING_VERSION = [^;]+;/g;
const matches = original.match(pattern);
if (!matches) {
  throw new Error(`No MARKETING_VERSION entries found in ${pbxprojPath}`);
}

const updated = original.replace(pattern, `MARKETING_VERSION = ${version};`);
if (updated === original) {
  console.info(`iOS MARKETING_VERSION already at ${version}; no change.`);
  process.exit(0);
}

writeFileSync(pbxprojPath, updated);
console.info(
  `Synced iOS MARKETING_VERSION -> ${version} (${matches.length} entr${
    matches.length === 1 ? 'y' : 'ies'
  } in project.pbxproj).`,
);

// --- helpers ---

/** Reads `--<name>=<value>` (or `--<name> <value>`) from an argv list. */
function parseArg(argv, name) {
  const flag = `--${name}`;
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) return argv[idx + 1];
  const prefix = `${flag}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

/**
 * Resolves `VITE_APP_VERSION` from the .env files Vite loads for the given
 * mode, in Vite's precedence order (later files override earlier). Returns
 * `undefined` if no file defines it. This is the file-resolution fallback used
 * when `process.env.VITE_APP_VERSION` is not set. Stripping merged keys from
 * the `processEnv` clone passed to dotenv-expand prevents its `inProcessEnv`
 * branch from overriding the merged file value with a Bun-auto-loaded `.env`
 * value, while still allowing `$VAR` references to resolve against the shell
 * environment for keys not defined in the env files.
 */
function resolveFileEnvVersion(root, mode) {
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
  // Merge all files in precedence order BEFORE expanding. dotenv-expand v11
  // writes every parsed key back into its `processEnv`, so expanding each file
  // in turn against the real `process.env` would let an earlier file's value
  // leak into `process.env` and suppress a later (higher-precedence) file's
  // value (the `inProcessEnv` branch keeps the existing env value when it
  // differs from the file). Merging first means expansion sees only the final
  // winning file value per key.
  let merged = {};
  for (const file of files) {
    const filePath = resolve(root, file);
    if (!existsSync(filePath)) continue;
    merged = { ...merged, ...dotEnvParse(readFileSync(filePath, 'utf8')) };
  }
  // Strip merged keys from the processEnv clone so dotenv-expand's
  // `inProcessEnv` branch does NOT let Bun-auto-loaded `.env` values override
  // our merged file resolution. `$VAR` references for keys NOT in the env
  // files still resolve against the shell environment.
  const processEnv = { ...process.env };
  for (const key of Object.keys(merged)) delete processEnv[key];
  const { parsed: expanded } = dotEnvExpand({
    parsed: merged,
    processEnv,
  });
  return expanded.VITE_APP_VERSION;
}
