// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  M1HarnessError,
  M1UsageError,
  parseM1Arguments,
  runM1FoundationVerification,
  type CommandRunner,
  type CommandSpec,
  type HarnessDependencies,
} from './m1-foundation-harness';

const temporaryDirectories: string[] = [];
const testedBehaviorCommit = 'a'.repeat(40);
type TestEnvironment = HarnessDependencies['env'];

const deployedEnvironment: TestEnvironment = {
  VITE_MOBILE_API_URL: 'https://api.vela.example/api/',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_example',
  VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'mobile-client-id',
  VITE_COGNITO_OAUTH_DOMAIN: 'vela.auth.us-east-1.amazoncognito.com',
  VITE_AWS_REGION: 'us-east-1',
};

const placeholderEnvironment: TestEnvironment = {
  VITE_MOBILE_API_URL: 'https://example.invalid/api/',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_ciPlaceholder',
  VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'ci-mobile-client-id',
  VITE_COGNITO_OAUTH_DOMAIN: 'ci-placeholder.auth.us-east-1.amazoncognito.com',
  VITE_AWS_REGION: 'us-east-1',
};

const expectedCommands: Array<[string, string[]]> = [
  ['bun', ['install', '--frozen-lockfile']],
  ['bun', ['run', 'lint']],
  ['bun', ['run', 'typecheck']],
  ['bun', ['run', 'compile']],
  ['bun', ['run', 'build']],
  ['bun', ['run', 'test']],
  ['bun', ['run', '--cwd', 'apps/vela-mobile', 'verify:production-diagnostics']],
  [
    'bun',
    [
      'run',
      '--cwd',
      'apps/vela-mobile',
      'scan:secrets',
      '--',
      '--root',
      'apps/vela-mobile',
    ],
  ],
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createTemporaryRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'vela-m1-harness-'));
  temporaryDirectories.push(repository);
  return repository;
}

function createRunner(exitCodes: number[] = []) {
  const calls: CommandSpec[] = [];
  const runCommand: CommandRunner = async (spec) => {
    calls.push(spec);
    const exitCode = exitCodes[calls.length - 1] ?? 0;
    return { exitCode, stdout: '', stderr: '' };
  };

  return { calls, runCommand };
}

function createDependencies(input: {
  repoRoot: string;
  env?: TestEnvironment;
  runCommand: CommandRunner;
  verifyGitCommitExists?: HarnessDependencies['verifyGitCommitExists'];
  resolveDirtyPaths?: HarnessDependencies['resolveDirtyPaths'];
  loadDeployedIdentityProof?: HarnessDependencies['loadDeployedIdentityProof'];
}): HarnessDependencies {
  const environment = input.env ?? deployedEnvironment;
  return {
    repoRoot: input.repoRoot,
    now: () => new Date('2026-08-03T02:15:00.000Z'),
    platform: 'darwin',
    env: environment,
    runCommand: input.runCommand,
    resolveTestedBehaviorCommit: async () => testedBehaviorCommit,
    verifyGitCommitExists: input.verifyGitCommitExists ?? (async () => true),
    resolveDirtyPaths: input.resolveDirtyPaths ?? (async () => []),
    loadDeployedIdentityProof:
      input.loadDeployedIdentityProof ?? (async () => deployedIdentityProofFrom(environment)),
  };
}

function deployedIdentityProofFrom(environment: TestEnvironment) {
  return {
    mobileApiUrl: environment.VITE_MOBILE_API_URL!,
    cognitoUserPoolId: environment.VITE_COGNITO_USER_POOL_ID!,
    cognitoMobileUserPoolClientId: environment.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID!,
    cognitoOAuthDomain: environment.VITE_COGNITO_OAUTH_DOMAIN!,
    cognitoRegion: environment.VITE_AWS_REGION!,
  };
}

function onlyManifest(manifests: Awaited<ReturnType<typeof runM1FoundationVerification>>) {
  expect(manifests).toHaveLength(1);
  return manifests[0]!;
}

function validManualInput() {
  return {
    runId: '20260803T021500Z-production-smoke',
    startedAt: '2026-08-03T02:15:00.000Z',
    endedAt: '2026-08-03T02:17:00.000Z',
    config: {
      source: 'process_env',
      class: 'deployed',
      apiOrigin: 'https://api.vela.example',
      region: 'us-east-1',
      oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
      publicIdentifiersConsistent: true,
    },
    host: { deviceAlias: 'test iPhone', operatingSystem: 'iOS 18' },
    evidence: [
      {
        kind: 'attachment',
        location: 'https://evidence.vela.example/production-smoke.png',
        mediaType: 'image/png',
        byteSize: 42,
        sha256: 'b'.repeat(64),
      },
    ],
    findings: [{ severity: 'info', summary: 'Physical observation recorded' }],
    outcome: 'passed',
  };
}

function expectUsageError(argv: string[]) {
  expect(() => parseM1Arguments(argv)).toThrow(M1UsageError);
}

describe('M1 foundation CLI arguments', () => {
  it('accepts each exact machine-phase argument pairing', () => {
    expect(parseM1Arguments(['--phase', 'automated'])).toEqual({
      mode: 'verify',
      phase: 'automated',
      requireDeployedConfig: false,
    });
    expect(
      parseM1Arguments(['--phase', 'ios-simulator', '--simulator-udid', 'simulator-id']),
    ).toEqual({
      mode: 'verify',
      phase: 'ios-simulator',
      simulatorUdid: 'simulator-id',
      requireDeployedConfig: false,
    });
    expect(
      parseM1Arguments(['--phase', 'ios-physical-preflight', '--device-id', 'device-id']),
    ).toEqual({
      mode: 'verify',
      phase: 'ios-physical-preflight',
      deviceId: 'device-id',
      requireDeployedConfig: false,
    });
    expect(
      parseM1Arguments([
        '--phase',
        'all',
        '--simulator-udid',
        'simulator-id',
        '--device-id',
        'device-id',
        '--require-deployed-config',
      ]),
    ).toEqual({
      mode: 'verify',
      phase: 'all',
      simulatorUdid: 'simulator-id',
      deviceId: 'device-id',
      requireDeployedConfig: true,
    });
  });

  it('rejects invalid phases, incomplete pairings, duplicates, and unknown flags', () => {
    expectUsageError(['--phase', 'not-a-phase']);
    expectUsageError(['--phase', 'ios-simulator']);
    expectUsageError(['--phase', 'ios-physical-preflight']);
    expectUsageError(['--phase', 'all', '--simulator-udid', 'simulator-id']);
    expectUsageError(['--phase', 'automated', '--simulator-udid', 'simulator-id']);
    expectUsageError(['--phase', 'automated', '--phase', 'automated']);
    expectUsageError(['--phase', 'automated', '--require-deployed-config', '--require-deployed-config']);
    expectUsageError(['--phase']);
    expectUsageError(['--phase', 'automated', '--unknown']);
  });

  it('accepts manual recording only with a full tested behavior commit and JSON input', () => {
    expect(
      parseM1Arguments([
        '--record-manual',
        'diagnostic-observation',
        '--tested-behavior-commit',
        testedBehaviorCommit,
        '--input',
        '/tmp/diagnostic.json',
      ]),
    ).toEqual({
      mode: 'record-manual',
      matrixClass: 'diagnostic-observation',
      testedBehaviorCommit,
      inputPath: '/tmp/diagnostic.json',
    });
    expectUsageError(['--record-manual', 'production-smoke', '--input', '/tmp/input.json']);
    expectUsageError([
      '--record-manual',
      'production-smoke',
      '--tested-behavior-commit',
      'abc123',
      '--input',
      '/tmp/input.json',
    ]);
    expectUsageError([
      '--record-manual',
      'production-smoke',
      '--tested-behavior-commit',
      testedBehaviorCommit,
      '--input',
      '/tmp/input.json',
      '--phase',
      'automated',
    ]);
  });
});

describe('automated M1 foundation verification', () => {
  it('runs the exact eight automated gates in order and records placeholder configuration', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        createDependencies({
          repoRoot: repository,
          env: placeholderEnvironment,
          runCommand: runner.runCommand,
        }),
      ),
    );

    expect(runner.calls.map(({ command, args }) => [command, args])).toEqual(expectedCommands);
    expect(manifest.outcome).toBe('passed');
    expect(manifest.exitCode).toBe(0);
    expect(manifest.config.class).toBe('placeholder');
    expect(manifest.config.publicIdentifiersConsistent).toBe(false);
  });

  it('stops at the fourth failed automated gate with the gate-failed exit', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner([0, 0, 0, 1]);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        createDependencies({ repoRoot: repository, runCommand: runner.runCommand }),
      ),
    );

    expect(manifest.outcome).toBe('gate_failed');
    expect(manifest.exitCode).toBe(4);
    expect(runner.calls).toHaveLength(4);
  });

  it('stores bounded secret-free failed-gate output as hashed external evidence', async () => {
    const repository = createTemporaryRepository();
    const calls: CommandSpec[] = [];
    const runCommand: CommandRunner = async (spec) => {
      calls.push(spec);
      return { exitCode: 1, stdout: 'the install gate failed', stderr: '' };
    };

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        createDependencies({ repoRoot: repository, runCommand }),
      ),
    );

    expect(calls).toHaveLength(1);
    expect(manifest.evidence).toEqual([
      expect.objectContaining({
        kind: 'local-hash',
        location: expect.stringMatching(/command-01-install\.txt$/u),
        mediaType: 'text/plain; charset=utf-8',
      }),
    ]);
    expect(existsSync(join(repository, manifest.evidence[0]!.location))).toBe(true);
  });

  it('returns prerequisite_missing before any production command when configuration is absent', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        createDependencies({ repoRoot: repository, env: {}, runCommand: runner.runCommand }),
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.exitCode).toBe(3);
    expect(runner.calls).toEqual([]);
  });

  it('records process_env as the source when an incomplete environment is rejected', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        createDependencies({
          repoRoot: repository,
          env: { VITE_MOBILE_API_URL: 'https://api.vela.example/api/' },
          runCommand: runner.runCommand,
        }),
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.config).toMatchObject({ source: 'process_env', class: 'missing' });
    expect(runner.calls).toEqual([]);
  });

  it('requires a full Git behavior commit before any machine gate can run', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    dependencies.resolveTestedBehaviorCommit = async () => 'a'.repeat(39);

    await expect(
      runM1FoundationVerification(parseM1Arguments(['--phase', 'automated']), dependencies),
    ).rejects.toThrow(M1HarnessError);
    expect(runner.calls).toEqual([]);
  });

  it('rejects MOBILE_SKIP_ENV_VALIDATION for a deployed closure run before commands', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated', '--require-deployed-config']),
        createDependencies({
          repoRoot: repository,
          env: { ...deployedEnvironment, MOBILE_SKIP_ENV_VALIDATION: 'true' },
          runCommand: runner.runCommand,
        }),
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.exitCode).toBe(3);
    expect(runner.calls).toEqual([]);
  });

  it('rejects dirty executable paths before it starts a machine gate', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const resolveDirtyPaths = vi.fn(async () => ['apps/vela-mobile/src/config/index.ts']);
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      resolveDirtyPaths,
    });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );

    expect(resolveDirtyPaths).toHaveBeenCalledWith(repository);
    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.evidence).toEqual([]);
    expect(runner.calls).toEqual([]);
  });

  it('allows documentation and generated HPA-210 evidence changes to accompany an automated run', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      resolveDirtyPaths: async () => [
        'CLAUDE.md',
        'docs/mobile/verification-notes.txt',
        'architecture/mobile/identity-diagram.json',
        '.superpowers/sdd/ledger.json',
        'apps/vela-mobile/docs/evidence/hpa-210/previous-run/manifest.json',
      ],
    });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('passed');
    expect(runner.calls).toHaveLength(expectedCommands.length);
  });

  it('requires complete deployed identity proof before closure commands run', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      loadDeployedIdentityProof: async () => null,
    });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated', '--require-deployed-config']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.config.publicIdentifiersConsistent).toBe(false);
    expect(runner.calls).toEqual([]);
  });

  it('rejects a deployed identity proof that disagrees with the loaded mobile configuration', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      loadDeployedIdentityProof: async () => ({
        ...deployedIdentityProofFrom(deployedEnvironment),
        cognitoMobileUserPoolClientId: 'different-mobile-client-id',
      }),
    });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated', '--require-deployed-config']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.config.publicIdentifiersConsistent).toBe(false);
    expect(JSON.stringify(manifest.findings)).not.toContain('different-mobile-client-id');
    expect(runner.calls).toEqual([]);
  });

  it('marks deployed identity as consistent only after a complete matching proof', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      loadDeployedIdentityProof: async () => ({
        ...deployedIdentityProofFrom(deployedEnvironment),
        mobileApiUrl: 'https://API.VELA.example/api',
        cognitoUserPoolId: ` ${deployedEnvironment.VITE_COGNITO_USER_POOL_ID!} `,
        cognitoMobileUserPoolClientId: ` ${
          deployedEnvironment.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID!
        } `,
        cognitoOAuthDomain: `${deployedEnvironment.VITE_COGNITO_OAUTH_DOMAIN!.toUpperCase()}.`,
        cognitoRegion: deployedEnvironment.VITE_AWS_REGION!.toUpperCase(),
      }),
    });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated', '--require-deployed-config']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('passed');
    expect(manifest.config.publicIdentifiersConsistent).toBe(true);
    expect(runner.calls).toHaveLength(expectedCommands.length);
  });

  it('loads a complete deployed identity proof from the CDK output file', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const outputsDirectory = join(repository, 'packages/cdk');
    mkdirSync(outputsDirectory, { recursive: true });
    writeFileSync(
      join(outputsDirectory, 'cdk-outputs.json'),
      JSON.stringify(
        Object.entries({
          MobileApiURL: deployedEnvironment.VITE_MOBILE_API_URL,
          CognitoUserPoolId: deployedEnvironment.VITE_COGNITO_USER_POOL_ID,
          CognitoMobileUserPoolClientId:
            deployedEnvironment.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID,
          CognitoOAuthDomain: deployedEnvironment.VITE_COGNITO_OAUTH_DOMAIN,
          CognitoRegion: deployedEnvironment.VITE_AWS_REGION,
        }).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })),
      ),
    );
    const dependencies: HarnessDependencies = {
      repoRoot: repository,
      now: () => new Date('2026-08-03T02:15:00.000Z'),
      platform: 'darwin',
      env: deployedEnvironment,
      runCommand: runner.runCommand,
      resolveTestedBehaviorCommit: async () => testedBehaviorCommit,
      resolveDirtyPaths: async () => [],
    };

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated', '--require-deployed-config']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('passed');
    expect(manifest.config.publicIdentifiersConsistent).toBe(true);
    expect(runner.calls).toHaveLength(expectedCommands.length);
  });
});

describe('M1 foundation CLI', () => {
  it('maps usage errors to exit 2 without starting verification', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { runM1FoundationCli } = await import('../scripts/verify-m1-foundation.mjs');

    await expect(runM1FoundationCli(['--phase', 'not-a-phase'])).resolves.toBe(2);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid M1 foundation verification arguments:'),
    );
  });
});

describe('manual M1 foundation recording', () => {
  it('rejects raw OAuth code material in quoted manual finding text before it writes evidence', async () => {
    const repository = createTemporaryRepository();
    const inputPath = join(repository, 'oauth-code.json');
    const syntheticCode = ['synthetic', 'oauth', 'authorization', 'code', 'material'].join('-');
    writeFileSync(
      inputPath,
      JSON.stringify({
        ...validManualInput(),
        findings: [
          {
            severity: 'info',
            summary: `Observed redirect payload: ${JSON.stringify({ code: syntheticCode })}`,
          },
        ],
      }),
    );

    await expect(
      runM1FoundationVerification(
        parseM1Arguments([
          '--record-manual',
          'production-smoke',
          '--tested-behavior-commit',
          testedBehaviorCommit,
          '--input',
          inputPath,
        ]),
        createDependencies({ repoRoot: repository, runCommand: createRunner().runCommand }),
      ),
    ).rejects.toThrow(M1UsageError);

    expect(existsSync(join(repository, 'apps/vela-mobile/docs/evidence/hpa-210'))).toBe(false);
  });

  it('rejects a full-looking behavior SHA that does not name a Git commit before it writes evidence', async () => {
    const repository = createTemporaryRepository();
    const inputPath = join(repository, 'nonexistent-commit.json');
    writeFileSync(inputPath, JSON.stringify(validManualInput()));

    await expect(
      runM1FoundationVerification(
        parseM1Arguments([
          '--record-manual',
          'production-smoke',
          '--tested-behavior-commit',
          testedBehaviorCommit,
          '--input',
          inputPath,
        ]),
        createDependencies({
          repoRoot: repository,
          runCommand: createRunner().runCommand,
          verifyGitCommitExists: async () => false,
        }),
      ),
    ).rejects.toThrow(M1UsageError);

    expect(existsSync(join(repository, 'apps/vela-mobile/docs/evidence/hpa-210'))).toBe(false);
  });

  it('writes a forced manual manifest below the supplied full behavior commit', async () => {
    const repository = createTemporaryRepository();
    const inputPath = join(repository, 'production-smoke.json');
    const olderBehaviorCommit = 'c'.repeat(40);
    const verifyGitCommitExists = vi.fn(async (commit: string) => commit === olderBehaviorCommit);
    writeFileSync(inputPath, JSON.stringify(validManualInput()));

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--record-manual',
          'production-smoke',
          '--tested-behavior-commit',
          olderBehaviorCommit,
          '--input',
          inputPath,
        ]),
        createDependencies({
          repoRoot: repository,
          runCommand: createRunner().runCommand,
          verifyGitCommitExists,
        }),
      ),
    );

    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      olderBehaviorCommit,
      '20260803T021500Z-production-smoke',
      'manifest.json',
    );
    expect(manifest.phase).toBe('manual');
    expect(manifest.matrixClass).toBe('production-smoke');
    expect(manifest.exitCode).toBe(0);
    expect(manifest.testedBehaviorCommit).toBe(olderBehaviorCommit);
    expect(verifyGitCommitExists).toHaveBeenCalledWith(olderBehaviorCommit, repository);
    expect(existsSync(manifestPath)).toBe(true);
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual(manifest);
  });

  it('rejects hostile manual JSON rather than allowing forced manifest fields to be injected', async () => {
    const repository = createTemporaryRepository();
    const inputPath = join(repository, 'hostile.json');
    writeFileSync(
      inputPath,
      JSON.stringify({ ...validManualInput(), phase: 'ios-simulator', exitCode: 0, commands: [] }),
    );

    await expect(
      runM1FoundationVerification(
        parseM1Arguments([
          '--record-manual',
          'production-smoke',
          '--tested-behavior-commit',
          testedBehaviorCommit,
          '--input',
          inputPath,
        ]),
        createDependencies({ repoRoot: repository, runCommand: createRunner().runCommand }),
      ),
    ).rejects.toThrow(M1UsageError);
  });

  it('rejects manual evidence metadata containing an account email address', async () => {
    const repository = createTemporaryRepository();
    const inputPath = join(repository, 'secret.json');
    writeFileSync(
      inputPath,
      JSON.stringify({
        ...validManualInput(),
        host: { deviceAlias: 'test iPhone', accountEmail: 'tester@example.com' },
      }),
    );

    await expect(
      runM1FoundationVerification(
        parseM1Arguments([
          '--record-manual',
          'production-smoke',
          '--tested-behavior-commit',
          testedBehaviorCommit,
          '--input',
          inputPath,
        ]),
        createDependencies({ repoRoot: repository, runCommand: createRunner().runCommand }),
      ),
    ).rejects.toThrow(M1UsageError);
  });

  it('rejects an iOS-style device identifier even when it is mislabelled as an alias', async () => {
    const repository = createTemporaryRepository();
    const inputPath = join(repository, 'device-identifier.json');
    writeFileSync(
      inputPath,
      JSON.stringify({
        ...validManualInput(),
        host: { deviceAlias: '00008120-001A185E0E234567' },
      }),
    );

    await expect(
      runM1FoundationVerification(
        parseM1Arguments([
          '--record-manual',
          'production-smoke',
          '--tested-behavior-commit',
          testedBehaviorCommit,
          '--input',
          inputPath,
        ]),
        createDependencies({ repoRoot: repository, runCommand: createRunner().runCommand }),
      ),
    ).rejects.toThrow(M1UsageError);
  });
});
