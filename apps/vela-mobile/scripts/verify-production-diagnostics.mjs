import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IOS_INTERACTION_PRODUCTION_FORBIDDEN_TOKENS } from '../src/diagnostics/ios-interaction-contract.ts';

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
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
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
  return findDiagnosticTokens(root, IOS_INTERACTION_PRODUCTION_FORBIDDEN_TOKENS);
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
