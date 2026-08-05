import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This is a local macOS pre-merge gate. It intentionally allows a placeholder
// VITE_MOBILE_API_URL (e.g. https://example.invalid/api/) so it can run without
// a live CDK deployment. The build:ios:assets step still enforces .env.production
// presence via the validate-mobile-api-url Vite plugin; only the deployed-config
// consistency check is bypassed here. Requiring injected .env.production from
// packages/cdk/cdk-outputs.json is the closure gate's job: run
// `bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json`
// for that check. To use real deployed config instead, run
// packages/cdk/scripts/inject-env.ts before this script so
// apps/vela-mobile/.env.production is freshly generated.

const PRODUCTION_FORBIDDEN_TOKENS = [
  'ios-interaction-diagnostics',
  'ios-interaction-entry',
  'iOS Interaction Diagnostics',
  '/diagnostics/ios-interactions',
  'vela:dev:ios-interaction-cold-entry',
  'tts-pronunciation-diagnostics',
  'tts-pronunciation-entry',
  '/diagnostics/tts-pronunciation',
  'Pronunciation diagnostics',
];

export const PRODUCTION_TEXT_ARTIFACT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.html',
  '.css',
  '.json',
  '.map',
  '.txt',
  '.svg',
  '.xml',
]);

const defaultRoot = fileURLToPath(new URL('../src-capacitor/www/', import.meta.url));

export async function findDiagnosticTokens(root, tokens) {
  const absoluteRoot = resolve(root);
  const matches = [];

  async function scan(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (directory === absoluteRoot && error?.code === 'ENOENT') {
        throw new Error(`Production artifact root does not exist: ${absoluteRoot}`);
      }
      throw error;
    }

    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await scan(path);
      } else if (
        entry.isFile() &&
        PRODUCTION_TEXT_ARTIFACT_EXTENSIONS.has(extname(entry.name).toLowerCase())
      ) {
        const contents = await readFile(path, 'utf8');
        for (const token of tokens) {
          if (contents.includes(token)) matches.push({ path, token });
        }
      }
    }
  }

  await scan(absoluteRoot);
  return matches.sort((left, right) => {
    const pathOrder = left.path.localeCompare(right.path);
    return pathOrder === 0 ? left.token.localeCompare(right.token) : pathOrder;
  });
}

export function findProductionDiagnosticTokens(root) {
  return findDiagnosticTokens(root, PRODUCTION_FORBIDDEN_TOKENS);
}

if (import.meta.main) {
  try {
    const matches = await findProductionDiagnosticTokens(defaultRoot);
    if (matches.length > 0) {
      console.error(
        `Production diagnostics token found:\n${matches
          .map((match) => `${relative(defaultRoot, match.path)}: ${JSON.stringify(match.token)}`)
          .join('\n')}`,
      );
      process.exit(1);
    }
    console.log(`No production diagnostics tokens found under ${defaultRoot}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
