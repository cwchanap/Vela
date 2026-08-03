// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
const PUBLIC_MOBILE_ENV_KEYS = [
  'VITE_MOBILE_API_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
].sort();
const simulatorUdid = [
  'd'.repeat(8),
  'e'.repeat(4),
  'a'.repeat(4),
  'd'.repeat(4),
  'b'.repeat(12),
].join('-');
const simulatorRuntime = 'com.apple.CoreSimulator.SimRuntime.iOS-18-2';
const physicalDeviceId = '00008120-001A185E0E234567';
const physicalSigningTeam = 'LOCAL-TEAM-MUST-NOT-PERSIST';

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

function createTemporaryExecutionWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'vela-m1-clean-workspace-'));
  temporaryDirectories.push(workspace);
  mkdirSync(join(workspace, 'apps/vela-mobile'), { recursive: true });
  return workspace;
}

function attachCleanExecutionWorkspace(
  dependencies: HarnessDependencies,
  workspace: string,
) {
  const dispose = vi.fn(async () => undefined);
  const createExecutionWorkspace = vi.fn(async () => ({ root: workspace, dispose }));
  Object.assign(dependencies, { createExecutionWorkspace });
  return { createExecutionWorkspace, dispose };
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

function createSimulatorRunner(input: {
  wwwRoot: string;
  bunVersion?: string;
  capacitorDependencyOutput?: string;
  mobileDependencyOutput?: string;
  mutateWebViewAssets?: boolean;
  simulatorDevices?: unknown;
  processList?: string;
}) {
  const calls: CommandSpec[] = [];
  const simulatorDevices =
    input.simulatorDevices ??
    {
      devices: {
        [simulatorRuntime]: [
          {
            udid: simulatorUdid,
            name: 'iPhone 16 Pro Simulator',
            isAvailable: true,
          },
        ],
      },
    };
  const runCommand: CommandRunner = async (spec) => {
    calls.push(spec);

    if (spec.command === 'xcodebuild' && spec.args[0] === '-version') {
      return { exitCode: 0, stdout: 'Xcode 16.2\nBuild version 16C5032a\n', stderr: '' };
    }
    if (spec.command === 'bun' && spec.args.join(' ') === '--version') {
      return { exitCode: 0, stdout: input.bunVersion ?? '1.3.1\n', stderr: '' };
    }
    if (spec.command === 'bun' && spec.args[0] === 'pm' && spec.args[1] === 'ls') {
      if (spec.cwd.endsWith('/src-capacitor')) {
        return {
          exitCode: 0,
          stdout:
            input.capacitorDependencyOutput ??
            [
              '├── @capacitor/app@7.1.2',
              '├── @capacitor/core@7.6.8',
              '├── @capacitor/ios@7.6.8',
              '├── @capacitor/keyboard@7.0.6',
              '└── unrelated-capacitor-dependency@9.9.9',
            ].join('\n'),
          stderr: '',
        };
      }
      return {
        exitCode: 0,
        stdout:
          input.mobileDependencyOutput ??
          [
            '/private/tmp/clean-mobile-workspace/node_modules (99)',
            '├── quasar@2.18.6',
            '└── unrelated-mobile-dependency@9.9.9',
          ].join('\n'),
        stderr: '',
      };
    }
    if (
      spec.command === 'xcrun' &&
      spec.args.join(' ') === 'simctl list devices available --json'
    ) {
      return { exitCode: 0, stdout: JSON.stringify(simulatorDevices), stderr: '' };
    }
    if (spec.command === 'bunx' && spec.args.join(' ') === 'cap sync ios') {
      if (input.mutateWebViewAssets) {
        writeFileSync(join(input.wwwRoot, 'index.html'), 'cap sync changed the verified bundle');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    }
    if (spec.command === 'xcodebuild' && spec.args[0] === '-showBuildSettings') {
      const derivedDataIndex = spec.args.indexOf('-derivedDataPath');
      const derivedDataPath = spec.args[derivedDataIndex + 1]!;
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            buildSettings: {
              TARGET_BUILD_DIR: join(
                derivedDataPath,
                'Build/Products/Release-iphonesimulator',
              ),
              WRAPPER_NAME: 'App.app',
              DEVELOPMENT_TEAM: 'LOCAL-TEAM-MUST-NOT-PERSIST',
            },
          },
        ]),
        stderr: '',
      };
    }
    if (spec.command === 'plutil') {
      return { exitCode: 0, stdout: 'Vela\n', stderr: '' };
    }
    if (
      spec.command === 'xcrun' &&
      spec.args.slice(0, 3).join(' ') === 'simctl spawn ' + simulatorUdid
    ) {
      return { exitCode: 0, stdout: input.processList ?? '/Applications/Vela\n', stderr: '' };
    }

    return { exitCode: 0, stdout: '', stderr: '' };
  };

  return { calls, runCommand };
}

function physicalDeviceList(overrides: Record<string, unknown> = {}) {
  return {
    result: {
      devices: [
        {
          identifier: physicalDeviceId,
          name: 'iPhone 16 Pro',
          model: 'iPhone17,1',
          available: true,
          trusted: true,
          developerMode: true,
          accountEmail: 'tester@example.com',
          ...overrides,
        },
      ],
    },
  };
}

function physicalBuildSettings(overrides: Record<string, unknown> = {}) {
  return [
    {
      buildSettings: {
        CODE_SIGN_STYLE: 'Automatic',
        DEVELOPMENT_TEAM: physicalSigningTeam,
        PRODUCT_BUNDLE_IDENTIFIER: 'com.vela.app',
        CODE_SIGN_IDENTITY: 'iPhone Developer',
        PROVISIONING_PROFILE: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ...overrides,
      },
    },
  ];
}

const codesigningIdentityOutput = [
  '  1) A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2 "iPhone Developer: Tester (LOCAL-TEAM)"',
  '     1 valid identity found',
].join('\n');

function createPhysicalPreflightRunner(input: {
  deviceList?: unknown;
  buildSettings?: unknown;
  deviceListExitCode?: number;
  buildSettingsExitCode?: number;
  codesigningIdentityOutput?: string;
  codesigningIdentityExitCode?: number;
} = {}) {
  const calls: CommandSpec[] = [];
  const rawJsonPaths: string[] = [];
  const runCommand: CommandRunner = async (spec) => {
    calls.push(spec);

    if (
      spec.command === 'xcrun' &&
      spec.args.slice(0, 3).join(' ') === 'devicectl list devices'
    ) {
      const jsonOutputIndex = spec.args.indexOf('--json-output');
      const rawJsonPath = spec.args[jsonOutputIndex + 1];
      if (typeof rawJsonPath === 'string') {
        rawJsonPaths.push(rawJsonPath);
        writeFileSync(rawJsonPath, JSON.stringify(input.deviceList ?? physicalDeviceList()));
      }
      return { exitCode: input.deviceListExitCode ?? 0, stdout: '', stderr: '' };
    }
    if (spec.command === 'xcodebuild' && spec.args[0] === '-showBuildSettings') {
      return {
        exitCode: input.buildSettingsExitCode ?? 0,
        stdout: JSON.stringify(input.buildSettings ?? physicalBuildSettings()),
        stderr: '',
      };
    }
    if (spec.command === 'security' && spec.args[0] === 'find-identity') {
      return {
        exitCode: input.codesigningIdentityExitCode ?? 0,
        stdout: input.codesigningIdentityOutput ?? codesigningIdentityOutput,
        stderr: '',
      };
    }

    return { exitCode: 0, stdout: '', stderr: '' };
  };

  return { calls, rawJsonPaths, runCommand };
}

function createDependencies(input: {
  repoRoot: string;
  env?: TestEnvironment;
  runCommand: CommandRunner;
  verifyGitCommitExists?: HarnessDependencies['verifyGitCommitExists'];
  resolveDirtyPaths?: HarnessDependencies['resolveDirtyPaths'];
  loadDeployedIdentityProof?: HarnessDependencies['loadDeployedIdentityProof'];
  createExecutionWorkspace?: HarnessDependencies['createExecutionWorkspace'];
  executionProcessEnvironment?: HarnessDependencies['executionProcessEnvironment'];
}): HarnessDependencies {
  const environment = input.env ?? deployedEnvironment;
  const workspace = createTemporaryExecutionWorkspace();
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
    createExecutionWorkspace:
      input.createExecutionWorkspace ?? (async () => ({ root: workspace, dispose: async () => undefined })),
    executionProcessEnvironment: input.executionProcessEnvironment ?? {},
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
  it('redacts an unsafe public configuration before it can create a workspace or persist a manifest', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const runner = createRunner();
    const unsafeOAuthDomain = 'SECRET-id-token.example';
    const dependencies = createDependencies({
      repoRoot: repository,
      env: { ...deployedEnvironment, VITE_COGNITO_OAUTH_DOMAIN: unsafeOAuthDomain },
      runCommand: runner.runCommand,
    });
    const { createExecutionWorkspace } = attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );
    const serializedManifest = readFileSync(manifestPath, 'utf8');

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.config).toEqual({
      source: 'process_env',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(manifest.findings).toContainEqual({
      severity: 'error',
      summary: 'Mobile production configuration contains prohibited sensitive content',
    });
    expect(runner.calls).toEqual([]);
    expect(createExecutionWorkspace).not.toHaveBeenCalled();
    expect(JSON.stringify(manifest)).not.toContain(unsafeOAuthDomain);
    expect(serializedManifest).not.toContain(unsafeOAuthDomain);
  });

  it('writes a redacted error manifest when unexpected final manifest content is unsafe', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const unsafePlatform = 'SECRET-id-token';
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    dependencies.platform = unsafePlatform as typeof process.platform;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );

    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({ platform: 'redacted' });
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain(unsafePlatform);
    expect(readFileSync(manifestPath, 'utf8')).not.toContain(unsafePlatform);
  });

  it('writes a redacted diagnostic manifest when a runtime platform violates the schema', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    dependencies.platform = null as unknown as typeof process.platform;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );
    const serializedManifest = readFileSync(manifestPath, 'utf8');

    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.exitCode).toBe(1);
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({ platform: 'redacted' });
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(serializedManifest).toContain('"outcome": "harness_error"');
    expect(serializedManifest).not.toContain('"platform": null');
  });

  it('writes a redacted diagnostic manifest when the final harness clock read is invalid', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const runner = createRunner();
    let finalClockReadShouldFail = false;
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      createExecutionWorkspace: async () => ({
        root: workspace,
        dispose: async () => {
          finalClockReadShouldFail = true;
        },
      }),
    });
    dependencies.now = () =>
      finalClockReadShouldFail ? new Date(Number.NaN) : new Date('2026-08-03T02:15:00.000Z');

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );

    expect(runner.calls).toHaveLength(expectedCommands.length);
    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({ platform: 'redacted' });
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(manifest.endedAt).toBe(manifest.startedAt);
    expect(readFileSync(manifestPath, 'utf8')).toContain('"outcome": "harness_error"');
  });

  it('redacts all completed gate state when detached-workspace cleanup throws', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const runner = createRunner();
    const dispose = vi.fn(async () => {
      throw new Error('SECRET-id-token cleanup failure');
    });
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      createExecutionWorkspace: async () => ({ root: workspace, dispose }),
    });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );
    const serializedManifest = readFileSync(manifestPath, 'utf8');

    expect(runner.calls).toHaveLength(expectedCommands.length);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({ platform: 'redacted' });
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(manifest.findings).toEqual([
      {
        severity: 'error',
        summary: 'The automated verification harness could not execute safely',
      },
    ]);
    expect(serializedManifest).not.toContain('SECRET-id-token');
    expect(serializedManifest).not.toContain(deployedEnvironment.VITE_COGNITO_OAUTH_DOMAIN!);
  });

  it('redacts prior gate state when a runner throws after several commands', async () => {
    const repository = createTemporaryRepository();
    const calls: CommandSpec[] = [];
    const runCommand: CommandRunner = async (spec) => {
      calls.push(spec);
      if (calls.length === 5) throw new Error('SECRET-id-token runner failure');
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const dependencies = createDependencies({ repoRoot: repository, runCommand });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );
    const serializedManifest = readFileSync(manifestPath, 'utf8');

    expect(calls).toHaveLength(5);
    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({ platform: 'redacted' });
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(manifest.findings).toEqual([
      {
        severity: 'error',
        summary: 'The automated verification harness could not execute safely',
      },
    ]);
    expect(serializedManifest).not.toContain('SECRET-id-token');
    expect(serializedManifest).not.toContain(deployedEnvironment.VITE_COGNITO_OAUTH_DOMAIN!);
  });

  it('runs the eight gates from a clean pinned checkout while writing the manifest in the original repository', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const runner = createRunner();
    const dependencies = createDependencies({
      repoRoot: repository,
      env: { ...deployedEnvironment, UNRELATED_SECRET: 'must-not-reach-gates' },
      runCommand: runner.runCommand,
    });
    const { createExecutionWorkspace, dispose } = attachCleanExecutionWorkspace(
      dependencies,
      workspace,
    );

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );

    expect(createExecutionWorkspace).toHaveBeenCalledWith({
      repoRoot: repository,
      testedBehaviorCommit,
    });
    expect(runner.calls.map(({ command, args }) => [command, args])).toEqual(expectedCommands);
    expect(runner.calls.every(({ cwd }) => cwd === workspace)).toBe(true);
    expect(runner.calls.map(({ env }) => Object.keys(env ?? {}).sort())).toEqual(
      Array.from({ length: expectedCommands.length }, () => PUBLIC_MOBILE_ENV_KEYS),
    );
    expect(
      existsSync(
        join(
          repository,
          'apps/vela-mobile/docs/evidence/hpa-210',
          testedBehaviorCommit,
          manifest.runId,
          'manifest.json',
        ),
      ),
    ).toBe(true);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('does not inherit ignored execution inputs from the original repository', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const ignoredPaths = [
      'apps/vela-mobile/node_modules/ignored-dependency/input.js',
      'apps/vela-mobile/src-capacitor/www/ignored-web-bundle.js',
      'apps/vela-mobile/src-capacitor/ios/ignored-native-input.txt',
      'apps/vela-mobile/.quasar/ignored-generated-input.json',
    ];
    for (const ignoredPath of ignoredPaths) {
      const file = join(repository, ignoredPath);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, 'ignored execution input');
    }

    const observedMissingInputs: boolean[] = [];
    const runCommand: CommandRunner = async (spec) => {
      observedMissingInputs.push(
        ...ignoredPaths.map((ignoredPath) => !existsSync(join(spec.cwd, ignoredPath))),
      );
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const dependencies = createDependencies({ repoRoot: repository, runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('passed');
    expect(observedMissingInputs).toHaveLength(expectedCommands.length * ignoredPaths.length);
    expect(observedMissingInputs.every(Boolean)).toBe(true);
  });

  it('stages the current run scanner input in the clean checkout before gate eight', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const runId = '20260803T021500Z-automated';
    const scanInputPath = join(
      workspace,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      runId,
      'scan-input.json',
    );
    const originalScanInputPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      runId,
      'scan-input.json',
    );
    let scannerInput: string | undefined;
    const runCommand: CommandRunner = async (spec) => {
      if (spec.label === 'mobile-secret-scan') {
        scannerInput = readFileSync(scanInputPath, 'utf8');
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const dependencies = createDependencies({
      repoRoot: repository,
      env: { ...deployedEnvironment, UNRELATED_SECRET: 'must-not-reach-scan-input' },
      runCommand,
    });
    attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('passed');
    expect(scannerInput).toContain('"schemaVersion": 1');
    expect(scannerInput).not.toContain('must-not-reach-scan-input');
    expect(existsSync(originalScanInputPath)).toBe(false);
  });

  it('disposes the clean execution checkout after a gate failure', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const runner = createRunner([1]);
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    const { dispose } = attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'automated']),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('gate_failed');
    expect(dispose).toHaveBeenCalledTimes(1);
  });

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

  it('does not copy failed-gate output to original evidence before the clean scanner succeeds', async () => {
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
    expect(manifest.evidence).toEqual([]);
    expect(manifest.findings).toContainEqual({
      severity: 'error',
      summary: 'Automated gate failed: install',
    });
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
    const workspace = createTemporaryExecutionWorkspace();
    const runner = createRunner();
    const resolveDirtyPaths = vi.fn(async () => ['apps/vela-mobile/src/config/index.ts']);
    const dependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
      resolveDirtyPaths,
    });
    const { createExecutionWorkspace } = attachCleanExecutionWorkspace(dependencies, workspace);

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
    expect(createExecutionWorkspace).not.toHaveBeenCalled();
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
    const workspace = createTemporaryExecutionWorkspace();
    const dependencies: HarnessDependencies = {
      repoRoot: repository,
      now: () => new Date('2026-08-03T02:15:00.000Z'),
      platform: 'darwin',
      env: deployedEnvironment,
      runCommand: runner.runCommand,
      resolveTestedBehaviorCommit: async () => testedBehaviorCommit,
      resolveDirtyPaths: async () => [],
      createExecutionWorkspace: async () => ({ root: workspace, dispose: async () => undefined }),
      executionProcessEnvironment: {},
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

describe('iOS Simulator M1 foundation verification', () => {
  it('runs the pinned Simulator build, launch, and process-presence sequence without persisting raw identifiers', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const runner = createSimulatorRunner({ wwwRoot });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    const { createExecutionWorkspace, dispose } = attachCleanExecutionWorkspace(
      dependencies,
      workspace,
    );
    const commandSequence: Array<[string, string[]]> = [];
    dependencies.resolveTestedBehaviorCommit = async () => {
      commandSequence.push(['git', ['rev-parse', 'HEAD']]);
      return testedBehaviorCommit;
    };
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    dependencies.sleep = sleep;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );
    commandSequence.push(...runner.calls.map(({ command, args }) => [command, args] as [string, string[]]));
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );

    expect(commandSequence.map(([command, args]) => [command, args[0], args[1]])).toEqual([
      ['git', 'rev-parse', 'HEAD'],
      ['xcodebuild', '-version', undefined],
      ['bun', '--version', undefined],
      ['bun', 'install', '--frozen-lockfile'],
      ['bun', 'pm', 'ls'],
      ['bun', 'pm', 'ls'],
      ['xcrun', 'simctl', 'list'],
      ['bun', 'run', '--cwd'],
      ['bunx', 'cap', 'sync'],
      ['xcodebuild', '-showBuildSettings', '-json'],
      ['xcodebuild', '-workspace', expect.any(String)],
      ['plutil', '-extract', 'CFBundleExecutable'],
      ['xcrun', 'simctl', 'bootstatus'],
      ['xcrun', 'simctl', 'install'],
      ['xcrun', 'simctl', 'launch'],
      ['xcrun', 'simctl', 'spawn'],
      ['xcrun', 'simctl', 'uninstall'],
      ['xcrun', 'simctl', 'shutdown'],
    ]);
    expect(runner.calls[2]!.args).toEqual(['install', '--frozen-lockfile']);
    expect(runner.calls[3]!.args).toEqual([
      'pm',
      'ls',
      '--all',
      'quasar',
    ]);
    expect(runner.calls[3]!.cwd).toBe(join(workspace, 'apps/vela-mobile'));
    expect(runner.calls[4]!.args).toEqual([
      'pm',
      'ls',
      '@capacitor/core',
      '@capacitor/ios',
      '@capacitor/app',
      '@capacitor/keyboard',
    ]);
    expect(runner.calls[4]!.cwd).toBe(join(workspace, 'apps/vela-mobile/src-capacitor'));
    expect(runner.calls[9]!.args).toEqual(
      expect.arrayContaining([
        '-scheme',
        'App',
        '-configuration',
        'Release',
        '-sdk',
        'iphonesimulator',
        '-destination',
        `platform=iOS Simulator,id=${simulatorUdid}`,
        'CODE_SIGNING_ALLOWED=NO',
        'build',
      ]),
    );
    expect(runner.calls[12]!.args).toEqual(['simctl', 'install', simulatorUdid, expect.any(String)]);
    expect(runner.calls[13]!.args).toEqual(['simctl', 'launch', simulatorUdid, 'com.vela.app']);
    expect(runner.calls[14]!.args).toEqual([
      'simctl',
      'spawn',
      simulatorUdid,
      '/bin/ps',
      '-A',
      '-o',
      'comm=',
    ]);
    const derivedDataPath = runner.calls[8]!.args[runner.calls[8]!.args.indexOf('-derivedDataPath') + 1]!;
    expect(runner.calls[10]!.args).toEqual([
      '-extract',
      'CFBundleExecutable',
      'raw',
      join(
        derivedDataPath,
        'Build/Products/Release-iphonesimulator/App.app/Info.plist',
      ),
    ]);
    expect(runner.calls.map(({ env }) => Object.keys(env ?? {}).sort())).toEqual(
      Array.from({ length: runner.calls.length }, () => PUBLIC_MOBILE_ENV_KEYS),
    );
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(createExecutionWorkspace).toHaveBeenCalledWith({ repoRoot: repository, testedBehaviorCommit });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manifest).toMatchObject({
      phase: 'ios-simulator',
      matrixClass: 'automated',
      outcome: 'passed',
      exitCode: 0,
      config: { class: 'deployed', publicIdentifiersConsistent: true },
      host: {
        simulatorAlias: 'iPhone 16 Pro Simulator',
        simulatorRuntime,
        xcodeVersion: '16.2',
        bunVersion: '1.3.1',
        quasarVersion: '2.18.6',
        capacitorCoreVersion: '7.6.8',
        capacitorIosVersion: '7.6.8',
        capacitorAppVersion: '7.1.2',
        capacitorKeyboardVersion: '7.0.6',
      },
    });
    expect(manifest.host).toMatchObject({
      appBundlePath: expect.stringMatching(/\.app$/u),
      wwwHashBefore: expect.stringMatching(/^[a-f0-9]{64}$/u),
      wwwHashAfter: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(manifest.host.wwwHashAfter).toBe(manifest.host.wwwHashBefore);
    expect(Object.keys(manifest.host).sort()).toEqual([
      'appBundlePath',
      'bunVersion',
      'capacitorAppVersion',
      'capacitorCoreVersion',
      'capacitorIosVersion',
      'capacitorKeyboardVersion',
      'quasarVersion',
      'simulatorAlias',
      'simulatorRuntime',
      'wwwHashAfter',
      'wwwHashBefore',
      'xcodeVersion',
    ]);
    const serializedManifest = readFileSync(manifestPath, 'utf8');
    expect(serializedManifest).not.toContain(simulatorUdid);
    expect(serializedManifest).not.toContain('LOCAL-TEAM-MUST-NOT-PERSIST');
    expect(serializedManifest).not.toContain('Build version 16C5032a');
    expect(serializedManifest).not.toContain('/Applications/Vela');
    expect(serializedManifest).not.toContain('/private/tmp/clean-mobile-workspace');
    expect(serializedManifest).not.toContain('unrelated-mobile-dependency@9.9.9');
    expect(serializedManifest).not.toContain('unrelated-capacitor-dependency@9.9.9');
  });

  it('rejects Bun releases below the mobile minimum before dependency installation', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const runner = createSimulatorRunner({ wwwRoot, bunVersion: '1.3.0\n' });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);
    dependencies.sleep = async () => undefined;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.exitCode).toBe(3);
    expect(manifest.host).toEqual({ xcodeVersion: '16.2' });
    expect(runner.calls.map(({ command, args }) => [command, args[0]])).toEqual([
      ['xcodebuild', '-version'],
      ['bun', '--version'],
    ]);
  });

  it('rejects an unsafe semver-shaped Bun output before persisting provenance', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const unsafeBunVersion = '999999999999999999999.3.1';
    const runner = createSimulatorRunner({ wwwRoot, bunVersion: `${unsafeBunVersion}\n` });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);
    dependencies.sleep = async () => undefined;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.host).toEqual({ xcodeVersion: '16.2' });
    expect(runner.calls.map(({ command, args }) => [command, args[0]])).toEqual([
      ['xcodebuild', '-version'],
      ['bun', '--version'],
    ]);
  });

  it('rejects oversized Bun prerelease metadata before persisting provenance', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const oversizedPrerelease = `1.3.2-${'g'.repeat(512)}`;
    const runner = createSimulatorRunner({ wwwRoot, bunVersion: `${oversizedPrerelease}\n` });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);
    dependencies.sleep = async () => undefined;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.host).toEqual({ xcodeVersion: '16.2' });
    expect(runner.calls.map(({ command, args }) => [command, args[0]])).toEqual([
      ['xcodebuild', '-version'],
      ['bun', '--version'],
    ]);
  });

  it('returns prerequisite_missing before native commands without macOS or an explicit Simulator identifier', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();
    const nonMacDependencies = createDependencies({
      repoRoot: repository,
      runCommand: runner.runCommand,
    });
    nonMacDependencies.platform = 'linux';

    const nonMacManifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-simulator', '--simulator-udid', simulatorUdid]),
        nonMacDependencies,
      ),
    );
    expect(nonMacManifest.outcome).toBe('prerequisite_missing');
    expect(nonMacManifest.exitCode).toBe(3);
    expect(runner.calls).toEqual([]);

    const missingIdentifierRunner = createRunner();
    const missingIdentifierManifest = onlyManifest(
      await runM1FoundationVerification(
        {
          mode: 'verify',
          phase: 'ios-simulator',
          requireDeployedConfig: false,
        } as unknown as ReturnType<typeof parseM1Arguments>,
        createDependencies({
          repoRoot: createTemporaryRepository(),
          runCommand: missingIdentifierRunner.runCommand,
        }),
      ),
    );
    expect(missingIdentifierManifest.outcome).toBe('prerequisite_missing');
    expect(missingIdentifierManifest.exitCode).toBe(3);
    expect(missingIdentifierRunner.calls).toEqual([]);
  });

  it('stops at the immutable-WebView gate when cap sync changes production assets', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const runner = createSimulatorRunner({ wwwRoot, mutateWebViewAssets: true });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('gate_failed');
    expect(manifest.exitCode).toBe(4);
    expect(manifest.host.wwwHashBefore).not.toBe(manifest.host.wwwHashAfter);
    expect(runner.calls.map(({ command, args }) => [command, args[0]])).toEqual([
      ['xcodebuild', '-version'],
      ['bun', '--version'],
      ['bun', 'install'],
      ['bun', 'pm'],
      ['bun', 'pm'],
      ['xcrun', 'simctl'],
      ['bun', 'run'],
      ['bunx', 'cap'],
    ]);
    expect(
      runner.calls.some(
        ({ command, args }) => command === 'xcodebuild' && args.includes('-showBuildSettings'),
      ),
    ).toBe(false);
  });

  it('returns a prerequisite manifest for unavailable Simulator discovery without leaking raw simctl data', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const rawSimulatorPath = `/private/var/db/CoreSimulator/Devices/${simulatorUdid}`;
    const runner = createSimulatorRunner({
      wwwRoot,
      simulatorDevices: {
        devices: {
          [simulatorRuntime]: [
            {
              udid: simulatorUdid,
              name: 'Unavailable Simulator',
              isAvailable: false,
              dataPath: rawSimulatorPath,
            },
          ],
        },
      },
    });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.exitCode).toBe(3);
    expect(runner.calls.map(({ command, args }) => [command, args[0]])).toEqual([
      ['xcodebuild', '-version'],
      ['bun', '--version'],
      ['bun', 'install'],
      ['bun', 'pm'],
      ['bun', 'pm'],
      ['xcrun', 'simctl'],
    ]);
    const serializedManifest = readFileSync(manifestPath, 'utf8');
    expect(serializedManifest).not.toContain(simulatorUdid);
    expect(serializedManifest).not.toContain(rawSimulatorPath);
    expect(serializedManifest).not.toContain('Unavailable Simulator');
  });

  it('fails the Simulator phase when the launched executable is absent after the bounded wait', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const runner = createSimulatorRunner({ wwwRoot, processList: '/usr/libexec/other-process\n' });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);
    dependencies.sleep = async () => undefined;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
        ]),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('gate_failed');
    expect(manifest.exitCode).toBe(4);
    expect(manifest.findings).toContainEqual({
      severity: 'error',
      summary: 'Launched simulator app process was not present after the bounded wait',
    });
    expect(runner.calls.at(-3)?.args).toEqual([
      'simctl',
      'spawn',
      simulatorUdid,
      '/bin/ps',
      '-A',
      '-o',
      'comm=',
    ]);
  });

  it('rejects a personal or opaque simulator display name instead of persisting it as an alias', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const personalAlias = "Ava's private simulator";
    const runner = createSimulatorRunner({
      wwwRoot,
      simulatorDevices: {
        devices: {
          [simulatorRuntime]: [
            { udid: simulatorUdid, name: personalAlias, isAvailable: true },
          ],
        },
      },
    });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-simulator', '--simulator-udid', simulatorUdid]),
        dependencies,
      ),
    );
    const serializedManifest = readFileSync(
      join(
        repository,
        'apps/vela-mobile/docs/evidence/hpa-210',
        testedBehaviorCommit,
        manifest.runId,
        'manifest.json',
      ),
      'utf8',
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.host).not.toHaveProperty('simulatorAlias');
    expect(serializedManifest).not.toContain(personalAlias);
  });

  it('uses the trusted-only redacted envelope when a Simulator runner throws', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const calls: CommandSpec[] = [];
    const runner: CommandRunner = async (spec) => {
      calls.push(spec);
      throw new Error(`SECRET-id-token simulator failure for ${simulatorUdid}`);
    };
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner });
    attachCleanExecutionWorkspace(dependencies, workspace);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-simulator', '--simulator-udid', simulatorUdid]),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );
    const serializedManifest = readFileSync(manifestPath, 'utf8');

    expect(calls).toHaveLength(1);
    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.exitCode).toBe(1);
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({});
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(serializedManifest).not.toContain('SECRET-id-token');
    expect(serializedManifest).not.toContain(simulatorUdid);
    expect(serializedManifest).not.toContain(deployedEnvironment.VITE_COGNITO_OAUTH_DOMAIN!);
  });

  it('redacts completed Simulator state when clean-workspace disposal throws', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const runner = createSimulatorRunner({ wwwRoot });
    const dispose = vi.fn(async () => {
      throw new Error(`SECRET-id-token cleanup failure for ${simulatorUdid}`);
    });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    dependencies.createExecutionWorkspace = async () => ({ root: workspace, dispose });
    dependencies.sleep = async () => undefined;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-simulator', '--simulator-udid', simulatorUdid]),
        dependencies,
      ),
    );
    const serializedManifest = readFileSync(
      join(
        repository,
        'apps/vela-mobile/docs/evidence/hpa-210',
        testedBehaviorCommit,
        manifest.runId,
        'manifest.json',
      ),
      'utf8',
    );

    expect(runner.calls).toHaveLength(17);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({});
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(serializedManifest).not.toContain('SECRET-id-token');
    expect(serializedManifest).not.toContain(simulatorUdid);
    expect(serializedManifest).not.toContain(deployedEnvironment.VITE_COGNITO_OAUTH_DOMAIN!);
  });

  it('runs Simulator cleanup before disposing the workspace and never uses a removed cwd', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const wwwRoot = join(workspace, 'apps/vela-mobile/src-capacitor/www');
    mkdirSync(wwwRoot, { recursive: true });
    writeFileSync(join(wwwRoot, 'index.html'), 'verified production WebView asset');
    const simulator = createSimulatorRunner({ wwwRoot });

    // Order log shared between the wrapped runCommand and dispose so the test
    // can prove cleanup ran before the worktree was removed.
    const orderLog: string[] = [];
    let cleanupCwdExisted = true;
    let disposeRanBeforeCleanup = false;
    const wrappedRunCommand: CommandRunner = async (spec) => {
      if (spec.label === 'simulator-cleanup-uninstall' || spec.label === 'simulator-cleanup-shutdown') {
        if (!existsSync(spec.cwd)) cleanupCwdExisted = false;
        orderLog.push(spec.label);
      }
      return simulator.runCommand(spec);
    };

    const dispose = async () => {
      if (orderLog.length === 0) disposeRanBeforeCleanup = true;
      orderLog.push('workspace-dispose');
      rmSync(workspace, { force: true, recursive: true });
    };

    const dependencies = createDependencies({ repoRoot: repository, runCommand: wrappedRunCommand });
    dependencies.createExecutionWorkspace = async () => ({ root: workspace, dispose });
    dependencies.sleep = async () => undefined;

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-simulator',
          '--simulator-udid',
          simulatorUdid,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('passed');
    expect(disposeRanBeforeCleanup).toBe(false);
    expect(cleanupCwdExisted).toBe(true);
    expect(orderLog).toEqual([
      'simulator-cleanup-uninstall',
      'simulator-cleanup-shutdown',
      'workspace-dispose',
    ]);
    // The cleanup commands used the worktree root as cwd, and it existed.
    const uninstallCall = simulator.calls.find(({ label }) => label === 'simulator-cleanup-uninstall');
    const shutdownCall = simulator.calls.find(({ label }) => label === 'simulator-cleanup-shutdown');
    expect(uninstallCall?.cwd).toBe(workspace);
    expect(shutdownCall?.cwd).toBe(workspace);
  });

  it('keeps --phase all explicitly unimplemented until the physical preflight can join it atomically', async () => {
    const repository = createTemporaryRepository();
    const runner = createRunner();

    await expect(
      runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'all',
          '--simulator-udid',
          simulatorUdid,
          '--device-id',
          'physical-device-id',
        ]),
        createDependencies({ repoRoot: repository, runCommand: runner.runCommand }),
      ),
    ).rejects.toThrow(M1HarnessError);
    expect(runner.calls).toEqual([]);
  });
});

describe('iOS physical-device M1 foundation preflight', () => {
  it('runs the pinned physical discovery and Debug signing checks without persisting raw device data', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const runner = createPhysicalPreflightRunner();
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    const { createExecutionWorkspace, dispose } = attachCleanExecutionWorkspace(
      dependencies,
      workspace,
    );

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments([
          '--phase',
          'ios-physical-preflight',
          '--device-id',
          physicalDeviceId,
          '--require-deployed-config',
        ]),
        dependencies,
      ),
    );
    const manifestPath = join(
      repository,
      'apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit,
      manifest.runId,
      'manifest.json',
    );
    const rawJsonPath = runner.rawJsonPaths[0]!;
    const xcodeWorkspace = join(workspace, 'apps/vela-mobile/src-capacitor/ios/App/App.xcworkspace');

    expect(runner.calls).toHaveLength(3);
    expect(runner.calls[0]).toMatchObject({
      command: 'xcrun',
      args: ['devicectl', 'list', 'devices', '--json-output', rawJsonPath],
      cwd: workspace,
    });
    expect(runner.calls[1]).toMatchObject({
      command: 'xcodebuild',
      args: [
        '-showBuildSettings',
        '-json',
        '-workspace',
        xcodeWorkspace,
        '-scheme',
        'App',
        '-configuration',
        'Debug',
        '-destination',
        `id=${physicalDeviceId}`,
      ],
      cwd: workspace,
    });
    expect(runner.calls[2]).toMatchObject({
      command: 'security',
      args: ['find-identity', '-v', '-p', 'codesigning'],
      cwd: workspace,
    });
    expect(runner.calls.map(({ env }) => Object.keys(env ?? {}).sort())).toEqual([
      PUBLIC_MOBILE_ENV_KEYS,
      PUBLIC_MOBILE_ENV_KEYS,
      PUBLIC_MOBILE_ENV_KEYS,
    ]);
    expect(createExecutionWorkspace).toHaveBeenCalledWith({ repoRoot: repository, testedBehaviorCommit });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(rawJsonPath.startsWith(tmpdir())).toBe(true);
    expect(rawJsonPath).not.toContain('/docs/evidence/');
    expect(existsSync(rawJsonPath)).toBe(false);
    expect(manifest).toMatchObject({
      phase: 'ios-physical-preflight',
      matrixClass: 'physical-preflight',
      outcome: 'passed',
      exitCode: 0,
      config: { class: 'deployed', publicIdentifiersConsistent: true },
      host: {
        deviceAlias: 'iPhone 16 Pro',
        deviceModel: 'iPhone17,1',
        signingReady: true,
      },
    });
    expect(Object.keys(manifest.host).sort()).toEqual([
      'deviceAlias',
      'deviceModel',
      'signingReady',
    ]);
    const serializedManifest = readFileSync(manifestPath, 'utf8');
    expect(serializedManifest).not.toContain(physicalDeviceId);
    expect(serializedManifest).not.toContain(physicalSigningTeam);
    expect(serializedManifest).not.toContain('tester@example.com');
    expect(serializedManifest).not.toContain(JSON.stringify(physicalDeviceList()));
  });

  it('returns prerequisite_missing without native commands on non-macOS', async () => {
    const repository = createTemporaryRepository();
    const runner = createPhysicalPreflightRunner();
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    dependencies.platform = 'linux';

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-physical-preflight', '--device-id', physicalDeviceId]),
        dependencies,
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.exitCode).toBe(3);
    expect(runner.calls).toEqual([]);
  });

  it.each([
    {
      name: 'the requested device is absent',
      deviceList: { result: { devices: [] } },
      expectedCallCount: 1,
      expectedHost: {},
    },
    {
      name: 'the requested device is unavailable',
      deviceList: physicalDeviceList({ available: false }),
      expectedCallCount: 1,
      expectedHost: {},
    },
    {
      name: 'the requested device is untrusted',
      deviceList: physicalDeviceList({ trusted: false }),
      expectedCallCount: 1,
      expectedHost: {},
    },
    {
      name: 'Developer Mode is disabled',
      deviceList: physicalDeviceList({ developerMode: false }),
      expectedCallCount: 1,
      expectedHost: {},
    },
    {
      name: 'the resolved signing team is empty',
      deviceList: physicalDeviceList(),
      buildSettings: physicalBuildSettings({ DEVELOPMENT_TEAM: '  ' }),
      expectedCallCount: 2,
      expectedHost: {
        deviceAlias: 'iPhone 16 Pro',
        deviceModel: 'iPhone17,1',
        signingReady: false,
      },
    },
    {
      name: 'the project resolves manual signing',
      deviceList: physicalDeviceList(),
      buildSettings: physicalBuildSettings({ CODE_SIGN_STYLE: 'Manual' }),
      expectedCallCount: 2,
      expectedHost: {
        deviceAlias: 'iPhone 16 Pro',
        deviceModel: 'iPhone17,1',
        signingReady: false,
      },
    },
    {
      name: 'the project resolves a different bundle identifier',
      deviceList: physicalDeviceList(),
      buildSettings: physicalBuildSettings({ PRODUCT_BUNDLE_IDENTIFIER: 'com.example.other' }),
      expectedCallCount: 2,
      expectedHost: {
        deviceAlias: 'iPhone 16 Pro',
        deviceModel: 'iPhone17,1',
        signingReady: false,
      },
    },
    {
      name: 'the resolved signing identity is empty',
      deviceList: physicalDeviceList(),
      buildSettings: physicalBuildSettings({ CODE_SIGN_IDENTITY: '' }),
      expectedCallCount: 2,
      expectedHost: {
        deviceAlias: 'iPhone 16 Pro',
        deviceModel: 'iPhone17,1',
        signingReady: false,
      },
    },
    {
      name: 'no provisioning profile is resolved',
      deviceList: physicalDeviceList(),
      buildSettings: physicalBuildSettings({ PROVISIONING_PROFILE: '', PROVISIONING_PROFILE_SPECIFIER: '' }),
      expectedCallCount: 2,
      expectedHost: {
        deviceAlias: 'iPhone 16 Pro',
        deviceModel: 'iPhone17,1',
        signingReady: false,
      },
    },
    {
      name: 'the keychain has no usable codesigning identity',
      deviceList: physicalDeviceList(),
      codesigningIdentityOutput: '     0 valid identities found',
      expectedCallCount: 3,
      expectedHost: {
        deviceAlias: 'iPhone 16 Pro',
        deviceModel: 'iPhone17,1',
        signingReady: false,
      },
    },
  ])('returns a redacted prerequisite manifest when $name', async (scenario) => {
    const repository = createTemporaryRepository();
    const runner = createPhysicalPreflightRunner(scenario);

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-physical-preflight', '--device-id', physicalDeviceId]),
        createDependencies({ repoRoot: repository, runCommand: runner.runCommand }),
      ),
    );
    const serializedManifest = readFileSync(
      join(
        repository,
        'apps/vela-mobile/docs/evidence/hpa-210',
        testedBehaviorCommit,
        manifest.runId,
        'manifest.json',
      ),
      'utf8',
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.exitCode).toBe(3);
    expect(manifest.host).toEqual(scenario.expectedHost);
    expect(runner.calls).toHaveLength(scenario.expectedCallCount);
    expect(serializedManifest).not.toContain(physicalDeviceId);
    expect(serializedManifest).not.toContain(physicalSigningTeam);
    expect(serializedManifest).not.toContain('tester@example.com');
  });

  it.each([
    { alias: 'authenticationState', deviceList: physicalDeviceList({ authenticationState: true }) },
    { alias: 'developerModeStatus', deviceList: physicalDeviceList({ developerModeStatus: true }) },
  ])('fails closed when CoreDevice $alias is a malformed boolean', async ({ deviceList }) => {
    const repository = createTemporaryRepository();
    const runner = createPhysicalPreflightRunner({ deviceList });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-physical-preflight', '--device-id', physicalDeviceId]),
        createDependencies({ repoRoot: repository, runCommand: runner.runCommand }),
      ),
    );

    expect(manifest.outcome).toBe('prerequisite_missing');
    expect(manifest.exitCode).toBe(3);
    expect(manifest.host).toEqual({});
    expect(runner.calls).toHaveLength(1);
  });

  it('accepts the semantic string forms of CoreDevice state aliases', async () => {
    const repository = createTemporaryRepository();
    const runner = createPhysicalPreflightRunner({
      deviceList: physicalDeviceList({
        authenticationState: 'trusted',
        developerModeStatus: 'enabled',
      }),
    });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-physical-preflight', '--device-id', physicalDeviceId]),
        createDependencies({ repoRoot: repository, runCommand: runner.runCommand }),
      ),
    );

    expect(manifest.outcome).toBe('passed');
    expect(manifest.exitCode).toBe(0);
  });

  it('uses the trusted-only redacted envelope when physical preflight execution throws', async () => {
    const repository = createTemporaryRepository();
    const calls: CommandSpec[] = [];
    let rawJsonPath: string | undefined;
    const runner: CommandRunner = async (spec) => {
      calls.push(spec);
      rawJsonPath = spec.args[spec.args.indexOf('--json-output') + 1];
      throw new Error(`SECRET-id-token physical failure for ${physicalDeviceId}`);
    };

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-physical-preflight', '--device-id', physicalDeviceId]),
        createDependencies({ repoRoot: repository, runCommand: runner }),
      ),
    );
    const serializedManifest = readFileSync(
      join(
        repository,
        'apps/vela-mobile/docs/evidence/hpa-210',
        testedBehaviorCommit,
        manifest.runId,
        'manifest.json',
      ),
      'utf8',
    );

    expect(calls).toHaveLength(1);
    expect(rawJsonPath).toEqual(expect.any(String));
    expect(existsSync(rawJsonPath!)).toBe(false);
    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.exitCode).toBe(1);
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({});
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(serializedManifest).not.toContain('SECRET-id-token');
    expect(serializedManifest).not.toContain(physicalDeviceId);
    expect(serializedManifest).not.toContain(deployedEnvironment.VITE_COGNITO_OAUTH_DOMAIN!);
  });

  it('uses the trusted-only redacted envelope when physical workspace disposal throws', async () => {
    const repository = createTemporaryRepository();
    const workspace = createTemporaryExecutionWorkspace();
    const deviceList = physicalDeviceList();
    const signingOutput = physicalBuildSettings();
    const runner = createPhysicalPreflightRunner({ deviceList, buildSettings: signingOutput });
    const dispose = vi.fn(async () => {
      throw new Error(
        `SECRET-id-token cleanup failure for ${physicalDeviceId} ${physicalSigningTeam}`,
      );
    });
    const dependencies = createDependencies({ repoRoot: repository, runCommand: runner.runCommand });
    dependencies.createExecutionWorkspace = async () => ({ root: workspace, dispose });

    const manifest = onlyManifest(
      await runM1FoundationVerification(
        parseM1Arguments(['--phase', 'ios-physical-preflight', '--device-id', physicalDeviceId]),
        dependencies,
      ),
    );
    const serializedManifest = readFileSync(
      join(
        repository,
        'apps/vela-mobile/docs/evidence/hpa-210',
        testedBehaviorCommit,
        manifest.runId,
        'manifest.json',
      ),
      'utf8',
    );

    expect(runner.calls).toHaveLength(3);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(manifest.outcome).toBe('harness_error');
    expect(manifest.exitCode).toBe(1);
    expect(manifest.config).toEqual({
      source: 'none',
      class: 'missing',
      publicIdentifiersConsistent: false,
    });
    expect(manifest.host).toEqual({});
    expect(manifest.commands).toEqual([]);
    expect(manifest.evidence).toEqual([]);
    expect(manifest.findings).toEqual([
      {
        severity: 'error',
        summary: 'The iOS physical-device preflight harness could not execute safely',
      },
    ]);
    expect(serializedManifest).not.toContain('SECRET-id-token');
    expect(serializedManifest).not.toContain(physicalDeviceId);
    expect(serializedManifest).not.toContain(physicalSigningTeam);
    expect(serializedManifest).not.toContain(JSON.stringify(deviceList));
    expect(serializedManifest).not.toContain(JSON.stringify(signingOutput));
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

  it.each(['oauthCode', 'oauth_code'] as const)(
    'rejects quoted OAuth-prefixed %s material before it writes evidence',
    async (field) => {
      const repository = createTemporaryRepository();
      const inputPath = join(repository, `${field}.json`);
      const syntheticValue = ['synthetic', 'oauth', 'field', 'material'].join('-');
      writeFileSync(
        inputPath,
        JSON.stringify({
          ...validManualInput(),
          findings: [
            {
              severity: 'info',
              summary: `Observed redirect payload: ${JSON.stringify({ [field]: syntheticValue })}`,
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
    },
  );

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
