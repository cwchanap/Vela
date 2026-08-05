import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  M1UsageError,
  parseM1Arguments,
  runM1FoundationVerification,
  spawnCommand,
  type HarnessDependencies,
} from './m1-foundation-harness';

describe('parseM1Arguments', () => {
  it('defaults evidence-dir when omitted', () => {
    const args = parseM1Arguments([]);
    expect(args.evidenceDir).toBeUndefined();
  });
  it('accepts --evidence-dir', () => {
    expect(parseM1Arguments(['--evidence-dir', '/tmp/x']).evidenceDir).toBe('/tmp/x');
  });
  it('rejects unknown flags', () => {
    expect(() => parseM1Arguments(['--phase', 'automated'])).toThrow(M1UsageError);
    expect(() => parseM1Arguments(['--require-deployed-config'])).toThrow(M1UsageError);
  });
});

const FAKE_MOBILE_ENV: Record<string, string> = {
  VITE_MOBILE_API_URL: 'https://vela.example.invalid/api/',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_pool',
  VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'clientid',
  VITE_COGNITO_OAUTH_DOMAIN: 'auth.example',
  VITE_AWS_REGION: 'us-east-1',
};

function fakeDeps(overrides: Partial<HarnessDependencies> = {}): HarnessDependencies {
  return {
    repoRoot: '/repo',
    now: () => new Date('2026-08-04T06:30:52.000Z'),
    platform: 'darwin',
    env: { ...FAKE_MOBILE_ENV },
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    resolveTestedBehaviorCommit: async () => 'a'.repeat(40),
    createExecutionWorkspace: async () => ({ root: '/ws', dispose: async () => undefined }),
    ...overrides,
  } as HarnessDependencies;
}

function onlyManifest(manifests: Awaited<ReturnType<typeof runM1FoundationVerification>>) {
  expect(manifests).toHaveLength(1);
  return manifests[0]!;
}

describe('runM1FoundationVerification (automated)', () => {
  it('emits a passed manifest when all 8 gates exit 0', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    const labels: string[] = [];
    const deps = fakeDeps({
      runCommand: async (spec) => {
        labels.push(spec.label);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    try {
      const manifest = onlyManifest(
        await runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps),
      );
      expect(manifest.outcome).toBe('passed');
      expect(manifest.exitCode).toBe(0);
      expect(manifest.schemaVersion).toBe(2);
      expect(manifest.phase).toBe('automated');
      expect(manifest.commands.map((c) => c.label)).toEqual([
        'install',
        'lint',
        'typecheck',
        'compile',
        'build',
        'test',
        'production-diagnostics',
        'mobile-secret-scan',
      ]);
      expect(labels).toHaveLength(8);
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('stops and marks failed on the first non-zero gate', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    const deps = fakeDeps({
      runCommand: async (spec) => ({
        exitCode: spec.label === 'typecheck' ? 1 : 0,
        stdout: '',
        stderr: '',
      }),
    });
    try {
      const manifest = onlyManifest(
        await runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps),
      );
      expect(manifest.outcome).toBe('failed');
      expect(manifest.exitCode).toBe(1);
      const ran = manifest.commands.map((c) => c.label);
      expect(ran).toContain('typecheck');
      expect(ran).not.toContain('build');
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('writes the manifest file under <evidenceDir>/<commit>/<runId>/manifest.json', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    try {
      const manifest = onlyManifest(
        await runM1FoundationVerification(
          parseM1Arguments(['--evidence-dir', evidenceDir]),
          fakeDeps(),
        ),
      );
      const file = join(evidenceDir, 'a'.repeat(40), manifest.runId, 'manifest.json');
      const written = JSON.parse(await readFile(file, 'utf8')) as { outcome: string };
      expect(written.outcome).toBe('passed');
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('writes a same-second rerun to a suffixed run directory whose receipt runId matches', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    try {
      const args = parseM1Arguments(['--evidence-dir', evidenceDir]);
      // The injected `now` is fixed, so both runs share the same base runId
      // and the second run must collide into a -2 suffixed directory.
      const first = onlyManifest(await runM1FoundationVerification(args, fakeDeps()));
      const second = onlyManifest(await runM1FoundationVerification(args, fakeDeps()));
      expect(second.runId).toBe(`${first.runId}-2`);
      const file = join(evidenceDir, 'a'.repeat(40), second.runId, 'manifest.json');
      const written = JSON.parse(await readFile(file, 'utf8')) as { runId: string };
      expect(written.runId).toBe(second.runId);
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });
});

describe('spawnCommand', () => {
  it('runs a command and reports exit code', async () => {
    const result = await spawnCommand({
      label: 'echo',
      command: process.execPath,
      args: ['--version'],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
  });
});
