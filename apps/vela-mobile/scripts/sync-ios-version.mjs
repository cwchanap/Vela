// Syncs the iOS native marketing version (MARKETING_VERSION in project.pbxproj)
// so iOS metadata and the Home page report the same version. The Home page
// reads `import.meta.env.VITE_APP_VERSION`, which Vite populates from the .env
// files it loads for the active mode (`.env`, `.env.local`, `.env.[mode]`,
// `.env.[mode].local`), with an already-set `process.env` value winning over
// all files. This script mirrors that resolution — Vite env files first, shell
// `VITE_APP_VERSION` override on top, then package.json "version" as the final
// fallback — so the UI and native bundle never drift when the version is set
// via a mode-specific file such as `.env.production`. Run via
// `bun run sync:ios-version` (wired into every Capacitor build/dev path).
// Pass `--mode=development` for dev runs so the same file set as Vite is loaded.

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
// Mirror Vite's loadEnv: load `.env`, `.env.local`, `.env.[mode]`,
// `.env.[mode].local` in order (later files override earlier), then let an
// already-set `process.env.VITE_APP_VERSION` win over all files, with
// package.json as the final fallback.
const fileEnvVersion = resolveFileEnvVersion(root, mode);
const version = process.env.VITE_APP_VERSION || fileEnvVersion || pkgVersion;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Resolved version is missing or not semver-like: "${version}"` +
      ` (VITE_APP_VERSION=${process.env.VITE_APP_VERSION ?? '<unset>'}` +
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
 * Resolves `VITE_APP_VERSION` from the same .env files Vite loads for the given
 * mode, in Vite's precedence order (later files override earlier). Returns
 * `undefined` if no file defines it. Does NOT consult `process.env` — the caller
 * applies the shell override on top, matching Vite's "existing env wins" rule.
 */
function resolveFileEnvVersion(root, mode) {
  const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];
  let merged = {};
  for (const file of files) {
    const filePath = resolve(root, file);
    if (!existsSync(filePath)) continue;
    const parsed = dotEnvParse(readFileSync(filePath, 'utf8'));
    // dotenv-expand resolves `$VAR` references against the running env plus the
    // accumulated file values, mirroring Vite's loadEnv behavior.
    const { parsed: expanded } = dotEnvExpand({ parsed });
    merged = { ...merged, ...expanded };
  }
  return merged.VITE_APP_VERSION;
}
