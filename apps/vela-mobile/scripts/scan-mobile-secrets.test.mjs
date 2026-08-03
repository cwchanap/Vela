// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMobileSecretRoot, scanMobileSecretRoots } from './scan-mobile-secrets.mjs';

const temporaryRoots = [];
const scannerPath = fileURLToPath(new URL('./scan-mobile-secrets.mjs', import.meta.url));
const iosFoundationArchitecturePath = fileURLToPath(
  new URL('../docs/ios-foundation-architecture.md', import.meta.url),
);

async function createTemporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'vela-secret-scan-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('scanMobileSecretRoots', () => {
  it('keeps the iOS foundation architecture record free of secret-shaped examples', async () => {
    const root = await createTemporaryRoot();
    await writeFile(
      join(root, 'ios-foundation-architecture.md'),
      await readFile(iosFoundationArchitecturePath, 'utf8'),
    );

    await expect(scanMobileSecretRoots({ roots: [root], exclusions: [] })).resolves.toEqual(
      expect.objectContaining({ findings: [] }),
    );
  });

  it('resolves the Task 5 repository-relative mobile root from a Bun package CWD', async () => {
    const repositoryRoot = await createTemporaryRoot();
    const mobilePackageRoot = join(repositoryRoot, 'apps', 'vela-mobile');
    const directCwdRoot = join(mobilePackageRoot, 'direct-cwd-root');
    await mkdir(directCwdRoot, { recursive: true });

    expect(
      resolveMobileSecretRoot('apps/vela-mobile', {
        cwd: mobilePackageRoot,
        repositoryRoot,
      }),
    ).toBe(mobilePackageRoot);
    expect(
      resolveMobileSecretRoot('direct-cwd-root', {
        cwd: mobilePackageRoot,
        repositoryRoot,
      }),
    ).toBe(directCwdRoot);

    const missingRoot = resolveMobileSecretRoot('does-not-exist', {
      cwd: mobilePackageRoot,
      repositoryRoot,
    });
    expect(missingRoot).toBe(join(mobilePackageRoot, 'does-not-exist'));
    await expect(scanMobileSecretRoots({ roots: [missingRoot] })).rejects.toThrow(/ENOENT/u);
  });

  it('scans supported files and returns redacted findings', async () => {
    const root = await createTemporaryRoot();
    await mkdir(join(root, 'nested'));
    await writeFile(
      join(root, 'nested', 'captured.log'),
      'Authorization: Bearer SECRET-access-token',
    );

    const result = await scanMobileSecretRoots({
      roots: [root],
      exclusions: [],
    });

    expect(result.findings).toEqual([
      expect.objectContaining({
        ruleId: 'bearer_value',
        path: 'nested/captured.log',
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET-access-token');
  });

  it('scans every supported mobile text artifact extension', async () => {
    const root = await createTemporaryRoot();
    const extensions = [
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
      '.ts',
      '.tsx',
      '.mts',
      '.swift',
      '.m',
      '.h',
      '.log',
      '.md',
      '.plist',
      '.pbxproj',
      '.xcconfig',
      '.entitlements',
      '.yaml',
      '.yml',
    ];
    await Promise.all(
      extensions.map((extension) =>
        writeFile(join(root, `artifact${extension}`), 'SECRET-callback-code'),
      ),
    );

    const result = await scanMobileSecretRoots({ roots: [root], exclusions: [] });

    expect(result.findings).toHaveLength(extensions.length);
    expect(new Set(result.findings.map(({ path }) => path))).toEqual(
      new Set(extensions.map((extension) => `artifact${extension}`)),
    );
    expect(result.findings.every(({ ruleId }) => ruleId === 'secret_sentinel')).toBe(true);
  });

  it('skips excluded directories, binary artifacts, and over-limit files with bounded records', async () => {
    const root = await createTemporaryRoot();
    const skippedSecret = 'SECRET-should-not-be-reported';
    await mkdir(join(root, 'node_modules'));
    await mkdir(join(root, 'DerivedData'));
    await writeFile(
      join(root, 'node_modules', 'dependency.log'),
      `Authorization: Bearer ${skippedSecret}`,
    );
    await writeFile(
      join(root, 'DerivedData', 'build.log'),
      `Authorization: Bearer ${skippedSecret}`,
    );
    await writeFile(
      join(root, 'archive.zip'),
      Buffer.from(`Authorization: Bearer ${skippedSecret}`),
    );
    await writeFile(join(root, 'image.png'), Buffer.from(`Authorization: Bearer ${skippedSecret}`));
    await writeFile(join(root, 'large.log'), `Authorization: Bearer ${skippedSecret}`.repeat(8));

    const result = await scanMobileSecretRoots({ roots: [root], maxTextBytes: 64 });

    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'node_modules', reason: 'excluded_directory' }),
        expect.objectContaining({ path: 'DerivedData', reason: 'excluded_directory' }),
        expect.objectContaining({ path: 'archive.zip', reason: 'unsupported_extension' }),
        expect.objectContaining({ path: 'image.png', reason: 'unsupported_extension' }),
        expect.objectContaining({ path: 'large.log', reason: 'max_text_bytes' }),
      ]),
    );
    expect(result.skipped).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain(skippedSecret);
  });

  it('skips binary content even when the extension is supported text', async () => {
    const root = await createTemporaryRoot();
    await writeFile(
      join(root, 'capture.log'),
      Buffer.concat([
        Buffer.from([0, 255, 16]),
        Buffer.from('Authorization: Bearer SECRET-access-token'),
      ]),
    );

    const result = await scanMobileSecretRoots({ roots: [root], exclusions: [] });

    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ path: 'capture.log', reason: 'binary_content' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET-access-token');
  });

  it('uses a shared base path to distinguish equivalent files across repeatable roots', async () => {
    const root = await createTemporaryRoot();
    const sourceRoot = join(root, 'source');
    const artifactRoot = join(root, 'artifacts');
    await Promise.all([
      mkdir(join(sourceRoot, 'nested'), { recursive: true }),
      mkdir(join(artifactRoot, 'nested'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(sourceRoot, 'nested', 'captured.log'),
        'Authorization: Bearer SECRET-access-token',
      ),
      writeFile(
        join(artifactRoot, 'nested', 'captured.log'),
        'Authorization: Bearer SECRET-access-token',
      ),
      writeFile(join(sourceRoot, 'nested', 'image.png'), Buffer.from([0])),
      writeFile(join(artifactRoot, 'nested', 'image.png'), Buffer.from([0])),
    ]);

    const result = await scanMobileSecretRoots({
      roots: [sourceRoot, artifactRoot],
      exclusions: [],
    });

    expect(result.findings.map(({ path }) => path)).toEqual([
      'artifacts/nested/captured.log',
      'source/nested/captured.log',
    ]);
    expect(result.skipped.map(({ path }) => path)).toEqual([
      'artifacts/nested/image.png',
      'source/nested/image.png',
    ]);
  });

  it('allows only explicit fixture values in test files', async () => {
    const root = await createTemporaryRoot();
    const realBearer = ['live', 'access', 'token1234567890'].join('-');
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'signature123456'].join(
      '.',
    );
    const privateKeyHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    const awsSecret = 'A'.repeat(40);
    const providerKey = ['sk', 'live', 'abcdefghijklmno'].join('-');
    await writeFile(
      join(root, 'fixture.test.mjs'),
      [
        'Authorization: Bearer SECRET-access-token',
        'https://bucket.example.invalid/audio.mp3?X-Amz-Credential=fixture&X-Amz-Signature=fixture',
      ].join('\n'),
    );
    await writeFile(
      join(root, 'real.test.mjs'),
      [
        `Authorization: Bearer ${realBearer}`,
        `token=${jwt}`,
        privateKeyHeader,
        `AWS_SECRET_ACCESS_KEY=${awsSecret}`,
        `OPENAI_API_KEY=${providerKey}`,
      ].join('\n'),
    );

    const result = await scanMobileSecretRoots({ roots: [root], exclusions: [] });

    expect(result.findings.map(({ ruleId }) => ruleId)).toEqual([
      'bearer_value',
      'jwt_value',
      'private_key',
      'aws_secret',
      'provider_key',
    ]);
    expect(result.findings.every(({ path }) => path === 'real.test.mjs')).toBe(true);
    expect(JSON.stringify(result)).not.toContain(realBearer);
  });

  it('writes a redacted JSON report and exits 4 when its CLI finds a secret', async () => {
    const root = await createTemporaryRoot();
    const report = join(root, 'reports', 'secrets.json');
    await writeFile(join(root, 'captured.log'), 'Authorization: Bearer SECRET-access-token');

    const result = spawnSync('bun', [scannerPath, '--root', root, '--json', report], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(4);
    const reportText = await readFile(report, 'utf8');
    expect(JSON.parse(reportText).findings).toEqual([
      expect.objectContaining({
        ruleId: 'bearer_value',
        path: 'captured.log',
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(reportText).not.toContain('SECRET-access-token');
  });

  it('exits 2 for invalid CLI arguments and 1 for scanner failures', async () => {
    const root = await createTemporaryRoot();
    const invalidArguments = spawnSync('bun', [scannerPath, '--max-bytes', 'nope'], {
      encoding: 'utf8',
    });
    const missingRoot = join(root, 'missing-root');
    const scannerFailure = spawnSync('bun', [scannerPath, '--root', missingRoot], {
      encoding: 'utf8',
    });

    expect(invalidArguments.status).toBe(2);
    expect(scannerFailure.status).toBe(1);
  });
});
