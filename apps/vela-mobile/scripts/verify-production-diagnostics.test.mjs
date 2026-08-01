// @vitest-environment node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findDiagnosticTokens,
  findProductionDiagnosticTokens,
} from './verify-production-diagnostics.mjs';
import { IOS_INTERACTION_PRODUCTION_FORBIDDEN_TOKENS } from '../src/diagnostics/ios-interaction-contract.ts';

const forbiddenTokens = [...IOS_INTERACTION_PRODUCTION_FORBIDDEN_TOKENS];
const ttsForbiddenTokens = [
  '/diagnostics/tts-pronunciation',
  'Pronunciation diagnostics',
  'tts-pronunciation-diagnostics',
  'tts-pronunciation-entry',
];

describe('verify-production-diagnostics', () => {
  it('returns no matches when emitted JavaScript excludes every forbidden token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'app.js'), 'console.log("production")');
    expect(await findDiagnosticTokens(root, forbiddenTokens)).toEqual([]);
  });

  it.each(forbiddenTokens)('finds forbidden token %s in nested emitted JavaScript', async (token) => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await mkdir(join(root, 'assets'));
    const artifact = join(root, 'assets', 'diagnostic.js');
    await writeFile(artifact, `const leaked=${JSON.stringify(token)}`);
    expect(await findProductionDiagnosticTokens(root)).toEqual([
      {
        path: artifact,
        token,
      },
    ]);
  });

  it('finds every TTS diagnostic token in emitted JavaScript', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    const artifact = join(root, 'app.js');
    await writeFile(artifact, `const leaked=${JSON.stringify(ttsForbiddenTokens.join(' '))}`);

    expect(await findProductionDiagnosticTokens(root)).toEqual([
      { path: artifact, token: '/diagnostics/tts-pronunciation' },
      { path: artifact, token: 'Pronunciation diagnostics' },
      { path: artifact, token: 'tts-pronunciation-diagnostics' },
      { path: artifact, token: 'tts-pronunciation-entry' },
    ]);
  });

  it('ignores non-JavaScript assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    await writeFile(join(root, 'notes.txt'), forbiddenTokens.join('\n'));
    expect(await findDiagnosticTokens(root, forbiddenTokens)).toEqual([]);
  });
});
