import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    assertCleanWorkingTree: async () => undefined,
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

  // Regression: a rejected runCommand (spawn error, signal, etc.) must not
  // bypass writeManifest. The harness contract is to always emit a receipt
  // for a gate failure; before the fix, a rejection propagated past the
  // finally block and no manifest was persisted.
  it('records a rejecting runCommand as a failed gate and still writes the manifest', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    const deps = fakeDeps({
      runCommand: async (spec) => {
        if (spec.label === 'typecheck') {
          throw new Error('spawn ENOENT');
        }
        return { exitCode: 0, stdout: '', stderr: '' };
      },
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
      const typecheck = manifest.commands.find((c) => c.label === 'typecheck');
      expect(typecheck?.status).toBe('failed');
      expect(typecheck?.exitCode).toBe(1);
      // The manifest file must be persisted despite the rejection.
      const file = join(evidenceDir, 'a'.repeat(40), manifest.runId, 'manifest.json');
      const written = JSON.parse(await readFile(file, 'utf8')) as { outcome: string };
      expect(written.outcome).toBe('failed');
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

const PRODUCTION_ENV_FILE = [
  'VITE_MOBILE_API_URL=https://file.example/api/',
  'VITE_COGNITO_USER_POOL_ID=us-east-1_pool',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=clientid',
  'VITE_COGNITO_OAUTH_DOMAIN=auth.example',
  'VITE_AWS_REGION=us-east-1',
].join('\n');

describe('runM1FoundationVerification (standalone CLI env reader)', () => {
  it('fills the gate environment from .env.production when process env omits the keys', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'vela-repo-'));
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    await mkdir(join(repoRoot, 'apps/vela-mobile'), { recursive: true });
    await writeFile(join(repoRoot, 'apps/vela-mobile/.env.production'), `${PRODUCTION_ENV_FILE}\n`);
    const gateEnv: Array<Record<string, string>> = [];
    const deps = fakeDeps({
      repoRoot,
      env: {},
      runCommand: async (spec) => {
        gateEnv.push(spec.env!);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    try {
      const manifest = onlyManifest(
        await runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps),
      );
      expect(manifest.outcome).toBe('passed');
      expect(gateEnv[0]!.VITE_MOBILE_API_URL).toBe('https://file.example/api/');
      expect(gateEnv[0]!.VITE_COGNITO_USER_POOL_ID).toBe('us-east-1_pool');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('ignores .env.local when CI is set (generated .env.production wins)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'vela-repo-'));
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    await mkdir(join(repoRoot, 'apps/vela-mobile'), { recursive: true });
    await writeFile(join(repoRoot, 'apps/vela-mobile/.env.production'), `${PRODUCTION_ENV_FILE}\n`);
    await writeFile(
      join(repoRoot, 'apps/vela-mobile/.env.local'),
      'VITE_MOBILE_API_URL=https://local.example/api/\n',
    );
    const gateEnv: Array<Record<string, string>> = [];
    const deps = fakeDeps({
      repoRoot,
      env: { CI: 'true' },
      runCommand: async (spec) => {
        gateEnv.push(spec.env!);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    try {
      await runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps);
      expect(gateEnv[0]!.VITE_MOBILE_API_URL).toBe('https://file.example/api/');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('rejects when no source provides the complete mobile configuration', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'vela-repo-'));
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    const deps = fakeDeps({
      repoRoot,
      env: {},
      runCommand: async () => {
        throw new Error('no gate should run with incomplete configuration');
      },
    });
    try {
      await expect(
        runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps),
      ).rejects.toThrow('Mobile build configuration incomplete');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('keeps an explicitly empty process override empty (does not fall back to the file)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'vela-repo-'));
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    await mkdir(join(repoRoot, 'apps/vela-mobile'), { recursive: true });
    await writeFile(join(repoRoot, 'apps/vela-mobile/.env.production'), `${PRODUCTION_ENV_FILE}\n`);
    const gateEnv: Array<Record<string, string>> = [];
    const deps = fakeDeps({
      repoRoot,
      env: { VITE_MOBILE_API_URL: '' },
      runCommand: async (spec) => {
        gateEnv.push(spec.env!);
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    try {
      await runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps);
      expect(gateEnv[0]!.VITE_MOBILE_API_URL).toBe('');
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('starts standalone under the Bun runtime', () => {
    const mobileRoot = process.cwd();
    const result = spawnSync('bun', ['scripts/verify-m1-foundation.mjs', '--bogus'], {
      cwd: mobileRoot,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Invalid M1 foundation verification arguments');
  });
});

describe('runM1FoundationVerification (clean-working-tree gate)', () => {
  it('rejects when the working tree has tracked staged/unstaged changes', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    const deps = fakeDeps({
      assertCleanWorkingTree: async () => {
        throw new Error(
          'Working tree has tracked staged/unstaged changes; commit or stash them before running verification.',
        );
      },
      runCommand: async () => {
        throw new Error('no gate should run when the working tree is dirty');
      },
    });
    try {
      await expect(
        runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps),
      ).rejects.toThrow(/tracked staged\/unstaged changes/u);
    } finally {
      await rm(evidenceDir, { recursive: true, force: true });
    }
  });

  it('runs the gates when the working tree is clean', async () => {
    const evidenceDir = await mkdtemp(join(tmpdir(), 'vela-ev-'));
    let checked = false;
    const deps = fakeDeps({
      assertCleanWorkingTree: async () => {
        checked = true;
      },
    });
    try {
      const manifest = onlyManifest(
        await runM1FoundationVerification(parseM1Arguments(['--evidence-dir', evidenceDir]), deps),
      );
      expect(checked).toBe(true);
      expect(manifest.outcome).toBe('passed');
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
