// @vitest-environment node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IOS_INTERACTION_DIAGNOSTICS_MARKER } from '../src/diagnostics/ios-interaction-contract.ts';
import { findDiagnosticMarker } from './verify-production-diagnostics.mjs';

describe('verify-production-diagnostics', () => {
  it('returns no files when emitted JavaScript excludes the marker', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'app.js'), 'console.log("production")');
    expect(await findDiagnosticMarker(root, IOS_INTERACTION_DIAGNOSTICS_MARKER)).toEqual([]);
  });

  it('finds the marker in nested emitted JavaScript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await mkdir(join(root, 'assets'));
    await writeFile(
      join(root, 'assets', 'diagnostic.js'),
      `const marker=${JSON.stringify(IOS_INTERACTION_DIAGNOSTICS_MARKER)}`,
    );
    expect(await findDiagnosticMarker(root, IOS_INTERACTION_DIAGNOSTICS_MARKER)).toEqual([
      join(root, 'assets', 'diagnostic.js'),
    ]);
  });

  it('ignores non-JavaScript assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'notes.txt'), IOS_INTERACTION_DIAGNOSTICS_MARKER);
    expect(await findDiagnosticMarker(root, IOS_INTERACTION_DIAGNOSTICS_MARKER)).toEqual([]);
  });
});
