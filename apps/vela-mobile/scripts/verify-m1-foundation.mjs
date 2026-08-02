import { fileURLToPath } from 'node:url';
import {
  M1UsageError,
  parseM1Arguments,
  runM1FoundationVerification,
  spawnCommand,
} from '../build/m1-foundation-harness.ts';

export async function runM1FoundationCli(argv = process.argv.slice(2)) {
  try {
    const args = parseM1Arguments(argv);
    const manifests = await runM1FoundationVerification(args, {
      repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
      now: () => new Date(),
      platform: process.platform,
      env: process.env,
      runCommand: spawnCommand,
    });
    return manifests.at(-1)?.exitCode ?? 1;
  } catch (error) {
    if (error instanceof M1UsageError) {
      console.error(`Invalid M1 foundation verification arguments: ${error.message}`);
      return 2;
    }
    const message = error instanceof Error ? error.message : 'unexpected failure';
    console.error(`M1 foundation verification failed: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runM1FoundationCli();
}
