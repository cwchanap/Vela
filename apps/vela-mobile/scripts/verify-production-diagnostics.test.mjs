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
import {
  TTS_PRONUNCIATION_DIAGNOSTIC_LABEL,
  TTS_PRONUNCIATION_DIAGNOSTIC_PATH,
  TTS_PRONUNCIATION_DIAGNOSTICS_MARKER,
  TTS_PRONUNCIATION_ENTRY_TEST_ID,
} from '../src/diagnostics/tts-pronunciation-contract.ts';

const forbiddenTokens = [...IOS_INTERACTION_PRODUCTION_FORBIDDEN_TOKENS];
const ttsForbiddenTokens = [
  TTS_PRONUNCIATION_DIAGNOSTIC_PATH,
  TTS_PRONUNCIATION_DIAGNOSTIC_LABEL,
  TTS_PRONUNCIATION_DIAGNOSTICS_MARKER,
  TTS_PRONUNCIATION_ENTRY_TEST_ID,
];
const emittedTextExtensions = [
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
      { path: artifact, token: TTS_PRONUNCIATION_DIAGNOSTIC_PATH },
      { path: artifact, token: TTS_PRONUNCIATION_DIAGNOSTIC_LABEL },
      { path: artifact, token: TTS_PRONUNCIATION_DIAGNOSTICS_MARKER },
      { path: artifact, token: TTS_PRONUNCIATION_ENTRY_TEST_ID },
    ]);
  });

  it.each(emittedTextExtensions)('finds diagnostic tokens in emitted %s artifacts', async (extension) => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    const artifact = join(root, `artifact${extension}`);
    const token = forbiddenTokens[0];
    await writeFile(artifact, `prefix ${token} suffix`);

    expect(await findDiagnosticTokens(root, [token])).toEqual([{ path: artifact, token }]);
  });

  it('ignores unsupported and binary artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    const token = forbiddenTokens[0];
    await writeFile(join(root, 'image.png'), Buffer.from(token));
    await writeFile(join(root, 'archive.zip'), Buffer.from(token));

    expect(await findDiagnosticTokens(root, [token])).toEqual([]);
  });
});
