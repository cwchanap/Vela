// Syncs the iOS native marketing version (MARKETING_VERSION in project.pbxproj)
// so iOS metadata and the Home page report the same version. The version is
// resolved the same way as quasar.config.ts: VITE_APP_VERSION env override
// first, then package.json "version" as fallback. Run via `bun run
// sync:ios-version` (wired into every Capacitor build/dev path).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = resolve(root, 'package.json');
const pbxprojPath = resolve(
  root,
  'src-capacitor/ios/App/App.xcodeproj/project.pbxproj',
);

const pkgVersion = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
// Mirror quasar.config.ts: env override wins, package.json is the fallback.
const version = process.env.VITE_APP_VERSION || pkgVersion;
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
