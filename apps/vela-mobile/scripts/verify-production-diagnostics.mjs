import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IOS_INTERACTION_DIAGNOSTICS_MARKER } from '../src/diagnostics/ios-interaction-contract.ts';

const defaultRoot = fileURLToPath(new URL('../src-capacitor/www/', import.meta.url));

export async function findDiagnosticMarker(root, marker) {
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
        if (contents.includes(marker)) matches.push(path);
      }
    }
  }

  await scan(absoluteRoot);
  return matches.sort();
}

if (import.meta.main) {
  try {
    const matches = await findDiagnosticMarker(defaultRoot, IOS_INTERACTION_DIAGNOSTICS_MARKER);
    if (matches.length > 0) {
      console.error(
        `Production diagnostics marker found:\n${matches
          .map((match) => relative(defaultRoot, match))
          .join('\n')}`,
      );
      process.exit(1);
    }
    console.log(`No production diagnostics marker found under ${defaultRoot}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
