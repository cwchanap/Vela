import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  M1_EXIT_CODE,
  createM1RunDirectory,
  createM1RunId,
  createManualM1Manifest,
  hashDirectory,
  validateM1Manifest,
  type M1CommandResult,
  type M1EvidenceReference,
  type M1Manifest,
  type M1Outcome,
} from './m1-foundation-contract';
import { scanMobileSecretText } from './mobile-secret-policy';
import { loadMobileBuildEnv, validateMobileBuildEnv } from './validate-mobile-api-url';

const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const MAX_MANUAL_INPUT_BYTES = 256 * 1024;
const MAX_RUN_DIRECTORY_ATTEMPTS = 1_000;
const MAX_GIT_STATUS_BYTES = 1024 * 1024;
const EXECUTION_WORKSPACE_PREFIX = 'vela-m1-foundation-';
const SIMULATOR_DERIVED_DATA_DIRECTORY = '.m1-ios-simulator';
const SIMULATOR_PROCESS_CHECK_DELAY_MS = 5_000;
const MAX_SIMULATOR_HOST_VALUE_LENGTH = 256;
const PHYSICAL_DEVICE_TEMPORARY_PREFIX = 'vela-m1-physical-device-';
const MAX_PHYSICAL_DEVICE_JSON_BYTES = 256 * 1024;
const GENERIC_AUTOMATED_HARNESS_FAILURE =
  'The automated verification harness could not execute safely';
const MANUAL_INPUT_DECODER = new TextDecoder('utf-8', { fatal: true });
const MOBILE_CONFIG_KEYS = [
  'VITE_MOBILE_API_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
] as const;
const DEPLOYED_IDENTITY_OUTPUT_KEYS = {
  mobileApiUrl: 'MobileApiURL',
  cognitoUserPoolId: 'CognitoUserPoolId',
  cognitoMobileUserPoolClientId: 'CognitoMobileUserPoolClientId',
  cognitoOAuthDomain: 'CognitoOAuthDomain',
  cognitoRegion: 'CognitoRegion',
} as const;
const SAFE_EXECUTION_ENVIRONMENT_KEYS = [
  'APPDATA',
  'BUN_INSTALL',
  'CI',
  'COMSPEC',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCALAPPDATA',
  'LOGNAME',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SystemRoot',
  'TEMP',
  'TERM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERPROFILE',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
] as const;
const FIELD_VALUE_ASSIGNMENT_PATTERN =
  /(?:^|[{\s,;])(?:\\?["'])?([A-Za-z][A-Za-z0-9_-]*)(?:\\?["'])?\s*[:=]\s*(?=(?:\\?["'])?[^\s,}\]])/giu;

export type CommandSpec = {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
};

export type CommandRunner = (spec: CommandSpec) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

type ProcessEnvironment = Record<string, string | undefined>;
type RuntimePlatform = typeof process.platform;

export type DeployedIdentityProof = {
  mobileApiUrl: string;
  cognitoUserPoolId: string;
  cognitoMobileUserPoolClientId: string;
  cognitoOAuthDomain: string;
  cognitoRegion: string;
};

export type ExecutionWorkspace = {
  root: string;
  dispose: () => Promise<void>;
};

export type HarnessDependencies = {
  repoRoot: string;
  now: () => Date;
  platform: RuntimePlatform;
  env: ProcessEnvironment;
  runCommand: CommandRunner;
  /**
   * Test-only injection point. Production callers omit this and resolve the
   * exact current Git HEAD directly, outside the eight automated gate calls.
   */
  resolveTestedBehaviorCommit?: () => Promise<string>;
  /**
   * Test-only injection point. Production callers verify the supplied manual
   * behavior commit with `git cat-file` without invoking a shell.
   */
  verifyGitCommitExists?: (commit: string, repoRoot: string) => Promise<boolean>;
  /**
   * Test-only injection point. Production callers inspect `git status` with
   * no shell before automated gates can produce verification evidence.
   */
  resolveDirtyPaths?: (repoRoot: string) => Promise<string[]>;
  /**
   * Test-only injection point. Production callers load the five public
   * identifiers from packages/cdk/cdk-outputs.json.
   */
  loadDeployedIdentityProof?: (repoRoot: string) => Promise<DeployedIdentityProof | null>;
  /**
   * Test-only injection point. Production callers create a detached Git
   * worktree at the exact tested behavior commit.
   */
  createExecutionWorkspace?: (input: {
    repoRoot: string;
    testedBehaviorCommit: string;
  }) => Promise<ExecutionWorkspace>;
  /**
   * Test-only injection point for the minimal non-secret process state that
   * gates need in addition to the five public mobile VITE values.
   */
  executionProcessEnvironment?: ProcessEnvironment;
  /**
   * Test-only clock seam for the bounded post-launch process check. Production
   * callers omit it and wait the five seconds required by the Simulator gate.
   */
  sleep?: (milliseconds: number) => Promise<void>;
};

export type M1VerifyArguments = {
  mode: 'verify';
  phase: 'automated' | 'ios-simulator' | 'ios-physical-preflight' | 'all';
  simulatorUdid?: string;
  deviceId?: string;
  requireDeployedConfig: boolean;
};

export type M1ManualArguments = {
  mode: 'record-manual';
  matrixClass: 'production-smoke' | 'diagnostic-observation';
  testedBehaviorCommit: string;
  inputPath: string;
};

export type M1Arguments = M1VerifyArguments | M1ManualArguments;

export class M1UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'M1UsageError';
  }
}

export class M1HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'M1HarnessError';
  }
}

type ConfigurationEvaluation = {
  config: M1Manifest['config'];
  isValid: boolean;
  loaded?: ReturnType<typeof loadMobileBuildEnv>;
};

type AutomatedManifestInput = {
  context: AutomaticRunContext;
  testedBehaviorCommit: string;
  startedAt: Date;
  endedAt: Date;
  outcome: M1Outcome;
  config: M1Manifest['config'];
  platform: RuntimePlatform | 'redacted';
  commands: M1CommandResult[];
  evidence: M1EvidenceReference[];
  findings: M1Manifest['findings'];
};

type TrustedAutomatedManifestInput = Pick<
  AutomatedManifestInput,
  'context' | 'testedBehaviorCommit' | 'startedAt' | 'endedAt'
>;

type AutomaticRunContext = {
  directory: string;
  runId: string;
};

type ManualInput = {
  runId: string;
  startedAt: string;
  endedAt: string;
  config: M1Manifest['config'];
  host: M1Manifest['host'];
  evidence: M1EvidenceReference[];
  findings: M1Manifest['findings'];
  outcome: 'passed' | 'gate_failed' | 'prerequisite_missing';
};

type UnknownRecord = Record<string, unknown>;

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new M1UsageError(`${flag} requires a value`);
  }
  return value;
}

function requireDistinctValue(
  target: { value?: string },
  value: string,
  flag: string,
): void {
  if (target.value !== undefined) {
    throw new M1UsageError(`${flag} may be supplied only once`);
  }
  target.value = value;
}

/**
 * Parses only the public harness syntax. Invalid user input is deliberately
 * separated from a failed verification gate so the CLI can preserve the
 * stable exit-code contract without writing a misleading pass manifest.
 */
export function parseM1Arguments(argv: string[]): M1Arguments {
  if (argv[0] === '--record-manual') {
    const matrixClass = requireValue(argv, 0, '--record-manual');
    if (matrixClass !== 'production-smoke' && matrixClass !== 'diagnostic-observation') {
      throw new M1UsageError(`Unsupported manual matrix class: ${matrixClass}`);
    }

    const testedBehaviorCommit: { value?: string } = {};
    const inputPath: { value?: string } = {};

    for (let index = 2; index < argv.length; index += 1) {
      const flag = argv[index];
      if (flag === '--tested-behavior-commit') {
        requireDistinctValue(
          testedBehaviorCommit,
          requireValue(argv, index, flag),
          '--tested-behavior-commit',
        );
        index += 1;
        continue;
      }
      if (flag === '--input') {
        requireDistinctValue(inputPath, requireValue(argv, index, flag), '--input');
        index += 1;
        continue;
      }
      throw new M1UsageError(`Unknown argument: ${flag}`);
    }

    if (!testedBehaviorCommit.value || !FULL_COMMIT_PATTERN.test(testedBehaviorCommit.value)) {
      throw new M1UsageError('--tested-behavior-commit must be a full lowercase 40-character SHA');
    }
    if (!inputPath.value) {
      throw new M1UsageError('--input is required for --record-manual');
    }

    return {
      mode: 'record-manual',
      matrixClass,
      testedBehaviorCommit: testedBehaviorCommit.value,
      inputPath: inputPath.value,
    };
  }

  if (argv[0] !== '--phase') {
    throw new M1UsageError('Specify --phase or --record-manual');
  }

  const phase = requireValue(argv, 0, '--phase');
  if (
    phase !== 'automated' &&
    phase !== 'ios-simulator' &&
    phase !== 'ios-physical-preflight' &&
    phase !== 'all'
  ) {
    throw new M1UsageError(`Unsupported phase: ${phase}`);
  }

  const simulatorUdid: { value?: string } = {};
  const deviceId: { value?: string } = {};
  let requireDeployedConfig = false;

  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--simulator-udid') {
      requireDistinctValue(simulatorUdid, requireValue(argv, index, flag), flag);
      index += 1;
      continue;
    }
    if (flag === '--device-id') {
      requireDistinctValue(deviceId, requireValue(argv, index, flag), flag);
      index += 1;
      continue;
    }
    if (flag === '--require-deployed-config') {
      if (requireDeployedConfig) {
        throw new M1UsageError('--require-deployed-config may be supplied only once');
      }
      requireDeployedConfig = true;
      continue;
    }
    throw new M1UsageError(`Unknown argument: ${flag}`);
  }

  if (phase === 'automated' && (simulatorUdid.value || deviceId.value)) {
    throw new M1UsageError('--phase automated does not accept device identifiers');
  }
  if (phase === 'ios-simulator' && (!simulatorUdid.value || deviceId.value)) {
    throw new M1UsageError('--phase ios-simulator requires only --simulator-udid');
  }
  if (phase === 'ios-physical-preflight' && (!deviceId.value || simulatorUdid.value)) {
    throw new M1UsageError('--phase ios-physical-preflight requires only --device-id');
  }
  if (phase === 'all' && (!simulatorUdid.value || !deviceId.value)) {
    throw new M1UsageError('--phase all requires --simulator-udid and --device-id');
  }

  return {
    mode: 'verify',
    phase,
    ...(simulatorUdid.value ? { simulatorUdid: simulatorUdid.value } : {}),
    ...(deviceId.value ? { deviceId: deviceId.value } : {}),
    requireDeployedConfig,
  };
}

function appendBounded(buffer: Buffer, chunk: Buffer): Buffer {
  const remaining = MAX_CAPTURED_OUTPUT_BYTES - buffer.length;
  if (remaining <= 0) return buffer;
  return Buffer.concat([buffer, chunk.subarray(0, remaining)]);
}

/**
 * Executes a command without a shell and retains at most 64 KiB per output
 * stream. The caller decides whether that bounded output is safe to persist.
 */
export const spawnCommand: CommandRunner = async (spec) =>
  new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let child;

    try {
      child = spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        // Automated gate specs carry a deliberately whitelisted environment.
        // Do not merge it with this process: that would leak unrelated local
        // secrets into a supposedly fresh execution checkout.
        env: (spec.env ?? process.env) as typeof process.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: exitCode ?? 1,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      });
    });
  });

type DirectGitResult = {
  exitCode: number;
  stdout: Buffer;
};

async function runGitDirectly(input: {
  repoRoot: string;
  args: string[];
  maxOutputBytes: number;
  failureMessage: string;
}): Promise<DirectGitResult> {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let outputTruncated = false;
    let settled = false;
    let child;

    try {
      child = spawn('git', input.args, {
        cwd: input.repoRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      reject(new M1HarnessError(input.failureMessage));
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stdout.length + bytes.length > input.maxOutputBytes) outputTruncated = true;
      stdout = Buffer.concat([
        stdout,
        bytes.subarray(0, Math.max(0, input.maxOutputBytes - stdout.length)),
      ]);
    });
    child.once('error', () => {
      if (settled) return;
      settled = true;
      reject(new M1HarnessError(input.failureMessage));
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      if (outputTruncated) {
        reject(new M1HarnessError(input.failureMessage));
        return;
      }
      resolve({ exitCode: exitCode ?? 1, stdout });
    });
  });
}

async function resolveGitHeadDirectly(repoRoot: string): Promise<string> {
  const result = await runGitDirectly({
    repoRoot,
    args: ['rev-parse', 'HEAD'],
    maxOutputBytes: 256,
    failureMessage: 'Unable to resolve the current Git HEAD',
  });
  if (result.exitCode !== 0) {
    throw new M1HarnessError('Unable to resolve the current Git HEAD');
  }

  const commit = result.stdout.toString('utf8').trim();
  if (!FULL_COMMIT_PATTERN.test(commit)) {
    throw new M1HarnessError('Git HEAD must resolve to a full lowercase 40-character SHA');
  }
  return commit;
}

async function verifyGitCommitExistsDirectly(commit: string, repoRoot: string): Promise<boolean> {
  const result = await runGitDirectly({
    repoRoot,
    args: ['cat-file', '-e', `${commit}^{commit}`],
    maxOutputBytes: 0,
    failureMessage: 'Unable to verify the supplied Git behavior commit',
  });
  return result.exitCode === 0;
}

function parseGitStatusPaths(output: Buffer): string[] {
  const records = output.toString('utf8').split('\0');
  const paths: string[] = [];

  for (let index = 0; index < records.length - 1; index += 1) {
    const record = records[index]!;
    if (record.length < 4 || record[2] !== ' ') {
      throw new M1HarnessError('Unable to inspect the Git working tree state safely');
    }

    const status = record.slice(0, 2);
    const path = record.slice(3);
    if (path === '') {
      throw new M1HarnessError('Unable to inspect the Git working tree state safely');
    }
    paths.push(path);

    if (status.includes('R') || status.includes('C')) {
      const originalPath = records[index + 1];
      if (!originalPath) {
        throw new M1HarnessError('Unable to inspect the Git working tree state safely');
      }
      paths.push(originalPath);
      index += 1;
    }
  }

  return paths;
}

async function resolveDirtyPathsDirectly(repoRoot: string): Promise<string[]> {
  const result = await runGitDirectly({
    repoRoot,
    args: ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    maxOutputBytes: MAX_GIT_STATUS_BYTES,
    failureMessage: 'Unable to inspect the Git working tree state safely',
  });
  if (result.exitCode !== 0) {
    throw new M1HarnessError('Unable to inspect the Git working tree state safely');
  }
  return parseGitStatusPaths(result.stdout);
}

async function createDetachedExecutionWorkspace(input: {
  repoRoot: string;
  testedBehaviorCommit: string;
}): Promise<ExecutionWorkspace> {
  const temporaryParent = await mkdtemp(join(tmpdir(), EXECUTION_WORKSPACE_PREFIX));
  const root = join(temporaryParent, 'checkout');

  try {
    const result = await runGitDirectly({
      repoRoot: input.repoRoot,
      args: ['worktree', 'add', '--detach', root, input.testedBehaviorCommit],
      maxOutputBytes: 4 * 1024,
      failureMessage: 'Unable to create the clean detached Git execution workspace',
    });
    if (result.exitCode !== 0) {
      throw new M1HarnessError('Unable to create the clean detached Git execution workspace');
    }
  } catch (error) {
    await rm(temporaryParent, { force: true, recursive: true }).catch(() => undefined);
    if (error instanceof M1HarnessError) throw error;
    throw new M1HarnessError('Unable to create the clean detached Git execution workspace');
  }

  return {
    root,
    dispose: async () => {
      const result = await runGitDirectly({
        repoRoot: input.repoRoot,
        args: ['worktree', 'remove', '--force', root],
        maxOutputBytes: 4 * 1024,
        failureMessage: 'Unable to remove the clean detached Git execution workspace',
      });
      if (result.exitCode !== 0) {
        throw new M1HarnessError('Unable to remove the clean detached Git execution workspace');
      }
      await rm(temporaryParent, { force: true, recursive: true });
    },
  };
}

async function resolveTestedBehaviorCommit(dependencies: HarnessDependencies): Promise<string> {
  const commit = dependencies.resolveTestedBehaviorCommit
    ? await dependencies.resolveTestedBehaviorCommit()
    : await resolveGitHeadDirectly(dependencies.repoRoot);

  if (!FULL_COMMIT_PATTERN.test(commit)) {
    throw new M1HarnessError('testedBehaviorCommit must be a full lowercase 40-character SHA');
  }
  return commit;
}

/**
 * Classifies only validated public build identifiers. The exact placeholder
 * detection deliberately catches the harmless CI configuration used by the
 * automated smoke without treating it as closure evidence.
 */
export function classifyMobileConfig(
  env: ReturnType<typeof loadMobileBuildEnv>,
): 'placeholder' | 'deployed' {
  const values = Object.values(env).filter((value): value is string => typeof value === 'string');
  const placeholder = values.some((value) =>
    /(?:example\.invalid|localhost|ciPlaceholder|ci-placeholder|placeholder)/iu.test(value),
  );

  return placeholder ? 'placeholder' : 'deployed';
}

function mobileConfigSource(
  env: ProcessEnvironment,
  mobileRoot: string,
  loaded: ReturnType<typeof loadMobileBuildEnv>,
): M1Manifest['config']['source'] {
  if (MOBILE_CONFIG_KEYS.some((key) => hasOwn(env, key))) return 'process_env';
  if (Object.values(loaded).some((value) => typeof value === 'string' && value.trim() !== '')) {
    return '.env.production';
  }
  if (existsSync(join(mobileRoot, '.env.production'))) return '.env.production';
  return 'none';
}

function publicApiOrigin(value: string): string {
  return new URL(value).origin;
}

function evaluateMobileConfiguration(dependencies: HarnessDependencies): ConfigurationEvaluation {
  const mobileRoot = join(dependencies.repoRoot, 'apps/vela-mobile');
  let source: M1Manifest['config']['source'] = 'none';

  try {
    const loaded = loadMobileBuildEnv('production', mobileRoot, dependencies.env);
    source = mobileConfigSource(dependencies.env, mobileRoot, loaded);
    validateMobileBuildEnv(loaded);

    return {
      isValid: true,
      loaded,
      config: {
        source,
        class: classifyMobileConfig(loaded),
        apiOrigin: publicApiOrigin(loaded.VITE_MOBILE_API_URL!),
        region: loaded.VITE_AWS_REGION!,
        oauthDomain: loaded.VITE_COGNITO_OAUTH_DOMAIN!,
        // This is deliberately false until --require-deployed-config matches
        // every loaded public identifier to the deployed CDK output proof.
        publicIdentifiersConsistent: false,
      },
    };
  } catch {
    return {
      isValid: false,
      config: {
        source,
        class: 'missing',
        publicIdentifiersConsistent: false,
      },
    };
  }
}

function redactedMissingConfiguration(
  source: M1Manifest['config']['source'] = 'none',
): M1Manifest['config'] {
  return {
    source,
    class: 'missing',
    publicIdentifiersConsistent: false,
  };
}

function containsUnsafePublicConfiguration(configuration: ConfigurationEvaluation): boolean {
  if (!configuration.loaded) return false;
  return containsUnsafeEvidenceText(
    JSON.stringify({ loaded: configuration.loaded, config: configuration.config }),
  );
}

type NormalizedDeployedIdentityProof = {
  mobileApiUrl: string;
  cognitoUserPoolId: string;
  cognitoMobileUserPoolClientId: string;
  cognitoOAuthDomain: string;
  cognitoRegion: string;
};

function normalizeRequiredIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized === '' ? undefined : normalized;
}

function normalizeMobileApiIdentifier(value: unknown): string | undefined {
  const candidate = normalizeRequiredIdentifier(value);
  if (!candidate) return undefined;

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    const pathname = url.pathname.replace(/\/+$/u, '') || '/';
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return undefined;
  }
}

function normalizeOauthDomain(value: unknown): string | undefined {
  const candidate = normalizeRequiredIdentifier(value);
  return candidate ? candidate.replace(/\.$/u, '').toLowerCase() : undefined;
}

function normalizeRegion(value: unknown): string | undefined {
  const candidate = normalizeRequiredIdentifier(value);
  return candidate?.toLowerCase();
}

function normalizeDeployedIdentityProof(
  proof: DeployedIdentityProof | null | undefined,
): NormalizedDeployedIdentityProof | undefined {
  if (!proof) return undefined;

  const mobileApiUrl = normalizeMobileApiIdentifier(proof.mobileApiUrl);
  const cognitoUserPoolId = normalizeRequiredIdentifier(proof.cognitoUserPoolId);
  const cognitoMobileUserPoolClientId = normalizeRequiredIdentifier(
    proof.cognitoMobileUserPoolClientId,
  );
  const cognitoOAuthDomain = normalizeOauthDomain(proof.cognitoOAuthDomain);
  const cognitoRegion = normalizeRegion(proof.cognitoRegion);
  if (
    !mobileApiUrl ||
    !cognitoUserPoolId ||
    !cognitoMobileUserPoolClientId ||
    !cognitoOAuthDomain ||
    !cognitoRegion
  ) {
    return undefined;
  }

  return {
    mobileApiUrl,
    cognitoUserPoolId,
    cognitoMobileUserPoolClientId,
    cognitoOAuthDomain,
    cognitoRegion,
  };
}

function normalizeLoadedMobileIdentity(
  loaded: ReturnType<typeof loadMobileBuildEnv>,
): NormalizedDeployedIdentityProof | undefined {
  return normalizeDeployedIdentityProof({
    mobileApiUrl: loaded.VITE_MOBILE_API_URL ?? '',
    cognitoUserPoolId: loaded.VITE_COGNITO_USER_POOL_ID ?? '',
    cognitoMobileUserPoolClientId: loaded.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID ?? '',
    cognitoOAuthDomain: loaded.VITE_COGNITO_OAUTH_DOMAIN ?? '',
    cognitoRegion: loaded.VITE_AWS_REGION ?? '',
  });
}

function hasMatchingDeployedIdentity(
  loaded: ReturnType<typeof loadMobileBuildEnv>,
  proof: DeployedIdentityProof | null,
): boolean {
  const normalizedLoaded = normalizeLoadedMobileIdentity(loaded);
  const normalizedProof = normalizeDeployedIdentityProof(proof);
  if (!normalizedLoaded || !normalizedProof) return false;

  return (
    normalizedLoaded.mobileApiUrl === normalizedProof.mobileApiUrl &&
    normalizedLoaded.cognitoUserPoolId === normalizedProof.cognitoUserPoolId &&
    normalizedLoaded.cognitoMobileUserPoolClientId ===
      normalizedProof.cognitoMobileUserPoolClientId &&
    normalizedLoaded.cognitoOAuthDomain === normalizedProof.cognitoOAuthDomain &&
    normalizedLoaded.cognitoRegion === normalizedProof.cognitoRegion
  );
}

/**
 * Loads the exact five public mobile identity values emitted by CDK. It is
 * intentionally strict: incomplete, malformed, or ambiguous output never
 * becomes closure proof, and no raw values are surfaced to callers' findings.
 */
export async function loadCdkDeployedIdentityProof(
  repoRoot: string,
): Promise<DeployedIdentityProof | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(repoRoot, 'packages/cdk/cdk-outputs.json'), 'utf8'),
    );
    if (!Array.isArray(parsed)) return null;

    const outputValues = new Map<string, string>();
    const expectedOutputKeys = new Set<string>(Object.values(DEPLOYED_IDENTITY_OUTPUT_KEYS));
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
      const record = item as UnknownRecord;
      const outputKey = record.OutputKey;
      if (typeof outputKey !== 'string' || !expectedOutputKeys.has(outputKey)) continue;
      if (outputValues.has(outputKey)) return null;
      const outputValue = normalizeRequiredIdentifier(record.OutputValue);
      if (!outputValue) return null;
      outputValues.set(outputKey, outputValue);
    }

    const mobileApiUrl = outputValues.get(DEPLOYED_IDENTITY_OUTPUT_KEYS.mobileApiUrl);
    const cognitoUserPoolId = outputValues.get(DEPLOYED_IDENTITY_OUTPUT_KEYS.cognitoUserPoolId);
    const cognitoMobileUserPoolClientId = outputValues.get(
      DEPLOYED_IDENTITY_OUTPUT_KEYS.cognitoMobileUserPoolClientId,
    );
    const cognitoOAuthDomain = outputValues.get(
      DEPLOYED_IDENTITY_OUTPUT_KEYS.cognitoOAuthDomain,
    );
    const cognitoRegion = outputValues.get(DEPLOYED_IDENTITY_OUTPUT_KEYS.cognitoRegion);
    if (
      !mobileApiUrl ||
      !cognitoUserPoolId ||
      !cognitoMobileUserPoolClientId ||
      !cognitoOAuthDomain ||
      !cognitoRegion
    ) {
      return null;
    }

    const proof = {
      mobileApiUrl,
      cognitoUserPoolId,
      cognitoMobileUserPoolClientId,
      cognitoOAuthDomain,
      cognitoRegion,
    };
    return normalizeDeployedIdentityProof(proof) ? proof : null;
  } catch {
    return null;
  }
}

async function deployedIdentityMatchesLoadedConfiguration(
  dependencies: HarnessDependencies,
  loaded: ReturnType<typeof loadMobileBuildEnv>,
): Promise<boolean> {
  try {
    const proof = dependencies.loadDeployedIdentityProof
      ? await dependencies.loadDeployedIdentityProof(dependencies.repoRoot)
      : await loadCdkDeployedIdentityProof(dependencies.repoRoot);
    return hasMatchingDeployedIdentity(loaded, proof);
  } catch {
    return false;
  }
}

function commandEnvironment(
  loaded: ReturnType<typeof loadMobileBuildEnv>,
  executionProcessEnvironment: ProcessEnvironment,
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const key of SAFE_EXECUTION_ENVIRONMENT_KEYS) {
    const value = executionProcessEnvironment[key];
    if (typeof value === 'string') result[key] = value;
  }
  for (const key of MOBILE_CONFIG_KEYS) {
    const value = loaded[key];
    if (typeof value !== 'string') {
      throw new M1HarnessError('Validated mobile build configuration is unexpectedly incomplete');
    }
    result[key] = value;
  }
  return result;
}

function automatedCommands(input: {
  dependencies: HarnessDependencies;
  executionRoot: string;
  loaded: ReturnType<typeof loadMobileBuildEnv>;
}): CommandSpec[] {
  const env = commandEnvironment(
    input.loaded,
    input.dependencies.executionProcessEnvironment ?? process.env,
  );
  const cwd = input.executionRoot;
  return [
    { label: 'install', command: 'bun', args: ['install', '--frozen-lockfile'], cwd, env },
    { label: 'lint', command: 'bun', args: ['run', 'lint'], cwd, env },
    { label: 'typecheck', command: 'bun', args: ['run', 'typecheck'], cwd, env },
    { label: 'compile', command: 'bun', args: ['run', 'compile'], cwd, env },
    { label: 'build', command: 'bun', args: ['run', 'build'], cwd, env },
    { label: 'test', command: 'bun', args: ['run', 'test'], cwd, env },
    {
      label: 'production-diagnostics',
      command: 'bun',
      args: ['run', '--cwd', 'apps/vela-mobile', 'verify:production-diagnostics'],
      cwd,
      env,
    },
    {
      label: 'mobile-secret-scan',
      command: 'bun',
      args: [
        'run',
        '--cwd',
        'apps/vela-mobile',
        'scan:secrets',
        '--',
        '--root',
        'apps/vela-mobile',
      ],
      cwd,
      env,
    },
  ];
}

function normalizeRepositoryRelativePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.replaceAll('\\', '/');
  if (
    path === '' ||
    path.includes('\0') ||
    path.startsWith('/') ||
    /^[A-Za-z]:\//u.test(path) ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return undefined;
  }
  return path;
}

/**
 * Documentation-only changes do not alter the executable build under test.
 * Everything else, including source, native, dependency, and tool changes,
 * blocks automated evidence until it is committed and retested. The returned
 * decision is deliberately path-free so generated manifests never disclose a
 * local checkout layout.
 */
function isAllowedNonExecutableDirtyPath(value: unknown): boolean {
  const path = normalizeRepositoryRelativePath(value);
  if (!path) return false;

  return (
    path === 'CLAUDE.md' ||
    path.endsWith('.md') ||
    path.startsWith('docs/') ||
    path.startsWith('architecture/') ||
    path.startsWith('.superpowers/') ||
    path.startsWith('apps/vela-mobile/docs/') ||
    path.startsWith('apps/vela-mobile/docs/evidence/hpa-210/')
  );
}

async function hasBlockingDirtyExecutableState(dependencies: HarnessDependencies): Promise<boolean> {
  const paths = dependencies.resolveDirtyPaths
    ? await dependencies.resolveDirtyPaths(dependencies.repoRoot)
    : await resolveDirtyPathsDirectly(dependencies.repoRoot);
  return paths.some((path) => !isAllowedNonExecutableDirtyPath(path));
}

function safeDate(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new M1HarnessError('The harness clock must return a valid Date');
  }
  return value;
}

function safeFinalManifestTiming(now: () => Date, startedAt: Date): {
  endedAt: Date;
  isReliable: boolean;
} {
  try {
    const endedAt = safeDate(now);
    return endedAt.getTime() >= startedAt.getTime()
      ? { endedAt, isReliable: true }
      : { endedAt: startedAt, isReliable: false };
  } catch {
    return { endedAt: startedAt, isReliable: false };
  }
}

function relativePath(repoRoot: string, path: string): string {
  const pathFromRoot = relative(repoRoot, path).replaceAll('\\', '/');
  return pathFromRoot === '' ? '.' : pathFromRoot;
}

function createCommandResult(input: {
  spec: CommandSpec;
  repoRoot: string;
  startedAt: Date;
  endedAt: Date;
  exitCode: number;
}): M1CommandResult {
  const elapsedMs = Math.max(0, input.endedAt.getTime() - input.startedAt.getTime());
  return {
    label: input.spec.label,
    command: input.spec.command,
    cwd: relativePath(input.repoRoot, input.spec.cwd),
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    elapsedMs,
    exitCode: input.exitCode,
    status: input.exitCode === 0 ? 'passed' : 'failed',
  };
}

function isSensitiveOAuthFieldName(rawFieldName: string): boolean {
  const fieldName = rawFieldName.replaceAll(/[_-]/gu, '').toLowerCase();
  if (fieldName === 'oauthdomain') return false;

  const isOauthScoped =
    fieldName.startsWith('oauth') ||
    fieldName.startsWith('auth') ||
    fieldName.includes('authorization');
  return (
    fieldName === 'authorization' ||
    fieldName === 'code' ||
    fieldName === 'token' ||
    fieldName === 'state' ||
    fieldName === 'nonce' ||
    fieldName.includes('token') ||
    (fieldName.includes('code') && (isOauthScoped || fieldName.includes('verifier'))) ||
    (isOauthScoped &&
      (fieldName.includes('verifier') ||
        fieldName.includes('secret') ||
        fieldName.includes('state') ||
        fieldName.includes('nonce')))
  );
}

function containsSensitiveOAuthFieldValue(text: string): boolean {
  FIELD_VALUE_ASSIGNMENT_PATTERN.lastIndex = 0;
  let match = FIELD_VALUE_ASSIGNMENT_PATTERN.exec(text);
  while (match) {
    if (isSensitiveOAuthFieldName(match[1]!)) return true;
    match = FIELD_VALUE_ASSIGNMENT_PATTERN.exec(text);
  }
  return false;
}

function containsUnsafeEvidenceText(text: string): boolean {
  if (scanMobileSecretText({ path: 'hpa-210-command-output.txt', text }).length > 0) return true;

  return [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /(?:[?&](?:code|state|nonce|code_verifier|access_token|id_token|refresh_token)=)/iu,
    /\bdata:[^\s,]+;base64,/iu,
    /\/oauth\/callback(?:[/?#]|$)/iu,
    /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8}-[0-9a-f]{16,}|[0-9a-f]{40})\b/iu,
  ].some((pattern) => pattern.test(text)) || containsSensitiveOAuthFieldValue(text);
}

async function createMachineRunContext(input: {
  repoRoot: string;
  testedBehaviorCommit: string;
  baseRunId: string;
}): Promise<AutomaticRunContext> {
  const evidenceRoot = join(input.repoRoot, 'apps/vela-mobile/docs/evidence/hpa-210');
  await mkdir(join(evidenceRoot, input.testedBehaviorCommit), { recursive: true });

  for (let attempt = 0; attempt < MAX_RUN_DIRECTORY_ATTEMPTS; attempt += 1) {
    const runId = attempt === 0 ? input.baseRunId : `${input.baseRunId}-${attempt + 1}`;
    const directory = createM1RunDirectory({
      evidenceRoot,
      testedBehaviorCommit: input.testedBehaviorCommit,
      runId,
    });
    try {
      await mkdir(directory);
      return { directory, runId };
    } catch (error) {
      if (isAlreadyExistsError(error)) continue;
      throw error;
    }
  }

  throw new M1HarnessError('Unable to allocate an append-only M1 run directory');
}

function createAutomatedManifest(input: AutomatedManifestInput): M1Manifest {
  return validateM1Manifest({
    schemaVersion: 1,
    runId: input.context.runId,
    testedBehaviorCommit: input.testedBehaviorCommit,
    phase: 'automated',
    matrixClass: 'automated',
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    outcome: input.outcome,
    exitCode: M1_EXIT_CODE[input.outcome],
    config: input.config,
    host: { platform: input.platform },
    commands: input.commands,
    evidence: input.evidence,
    findings: input.findings,
  });
}

function containsUnsafeAutomatedManifestContent(manifest: M1Manifest): boolean {
  // The validated behavior commit is an expected full SHA, which the generic
  // text scanner intentionally treats as sensitive-looking material. Scan
  // every other serialized field before the original evidence writer runs.
  const { testedBehaviorCommit: _testedBehaviorCommit, ...content } = manifest;
  return containsUnsafeEvidenceText(JSON.stringify(content));
}

function normalizedFallbackManifestTimes(input: TrustedAutomatedManifestInput): {
  startedAt: Date;
  endedAt: Date;
} {
  const epoch = new Date(0);
  const startedAt =
    input.startedAt instanceof Date && Number.isFinite(input.startedAt.getTime())
      ? input.startedAt
      : epoch;
  const endedAt =
    input.endedAt instanceof Date &&
    Number.isFinite(input.endedAt.getTime()) &&
    input.endedAt.getTime() >= startedAt.getTime()
      ? input.endedAt
      : startedAt;
  return { startedAt, endedAt };
}

function createRedactedAutomatedManifest(
  input: TrustedAutomatedManifestInput,
  summary: string,
): M1Manifest {
  const { startedAt, endedAt } = normalizedFallbackManifestTimes(input);
  return validateM1Manifest({
    schemaVersion: 1,
    runId: input.context.runId,
    testedBehaviorCommit: input.testedBehaviorCommit,
    phase: 'automated',
    matrixClass: 'automated',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    outcome: 'harness_error',
    exitCode: M1_EXIT_CODE.harness_error,
    config: redactedMissingConfiguration(),
    host: { platform: 'redacted' },
    commands: [],
    evidence: [],
    findings: [{ severity: 'error', summary }],
  });
}

function createSafeAutomatedManifest(input: AutomatedManifestInput): M1Manifest {
  const trustedInput: TrustedAutomatedManifestInput = {
    context: input.context,
    testedBehaviorCommit: input.testedBehaviorCommit,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  };

  try {
    const manifest = createAutomatedManifest(input);
    if (!containsUnsafeAutomatedManifestContent(manifest)) return manifest;
    return createRedactedAutomatedManifest(
      trustedInput,
      'The automated verification manifest contained prohibited sensitive content',
    );
  } catch {
    // Candidate schema validation and serialization both happen before the
    // evidence writer. The fallback omits every candidate field that could be
    // runtime-invalid or unsafe, so a context that already exists always gets
    // a valid diagnostic manifest instead of a raw harness exception.
    return createRedactedAutomatedManifest(
      trustedInput,
      'The automated verification manifest could not be serialized safely',
    );
  }
}

async function writeManifest(directory: string, manifest: M1Manifest): Promise<void> {
  await writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: 'wx',
  });
}

/**
 * Stages only harness-generated metadata inside the clean checkout so the
 * eighth gate scans the current run's material before anything is persisted
 * back to the original repository. It deliberately contains no stdout/stderr
 * payload and is deleted with the detached worktree after the run.
 */
async function stageCleanScannerInput(input: {
  executionRoot: string;
  testedBehaviorCommit: string;
  runId: string;
  config: M1Manifest['config'];
  commands: M1CommandResult[];
}): Promise<void> {
  const directory = createM1RunDirectory({
    evidenceRoot: join(input.executionRoot, 'apps/vela-mobile/docs/evidence/hpa-210'),
    testedBehaviorCommit: input.testedBehaviorCommit,
    runId: input.runId,
  });
  await mkdir(directory, { recursive: true });

  const scanInput = JSON.stringify(
    {
      schemaVersion: 1,
      runId: input.runId,
      phase: 'automated',
      config: input.config,
      commands: input.commands,
    },
    null,
    2,
  );
  if (containsUnsafeEvidenceText(scanInput)) {
    throw new M1HarnessError('Unable to stage clean scanner input safely');
  }
  await writeFile(join(directory, 'scan-input.json'), `${scanInput}\n`, { flag: 'wx' });
}

type MachinePreflight = {
  configuration: ConfigurationEvaluation;
  outcome: M1Outcome;
  findings: M1Manifest['findings'];
};

/**
 * Establishes the trusted public configuration and clean-worktree provenance
 * shared by every machine phase. No native command or detached execution
 * checkout can begin until this preflight has completed successfully.
 */
async function evaluateMachinePreflight(
  args: M1VerifyArguments,
  dependencies: HarnessDependencies,
  evidenceLabel: string,
): Promise<MachinePreflight> {
  const findings: M1Manifest['findings'] = [];
  let configuration = evaluateMobileConfiguration(dependencies);
  let outcome: M1Outcome = 'passed';

  try {
    if (await hasBlockingDirtyExecutableState(dependencies)) {
      outcome = 'prerequisite_missing';
      findings.push({
        severity: 'error',
        summary: 'Executable workspace changes are present; run from a clean executable state',
      });
    }
  } catch {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: `Git working tree state could not be verified before ${evidenceLabel} evidence`,
    });
  }

  if (containsUnsafePublicConfiguration(configuration)) {
    configuration = {
      isValid: false,
      config: redactedMissingConfiguration(configuration.config.source),
    };
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'Mobile production configuration contains prohibited sensitive content',
    });
  } else if (!configuration.isValid) {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'Mobile production configuration is missing or invalid',
    });
  } else if (
    outcome === 'passed' &&
    args.requireDeployedConfig &&
    dependencies.env.MOBILE_SKIP_ENV_VALIDATION === 'true'
  ) {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'MOBILE_SKIP_ENV_VALIDATION=true is not allowed for deployed closure runs',
    });
  } else if (
    outcome === 'passed' &&
    args.requireDeployedConfig &&
    configuration.config.class !== 'deployed'
  ) {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'A deployed mobile configuration is required for closure evidence',
    });
  }

  if (outcome === 'passed' && args.requireDeployedConfig && configuration.loaded) {
    const publicIdentifiersConsistent = await deployedIdentityMatchesLoadedConfiguration(
      dependencies,
      configuration.loaded,
    );
    configuration = {
      ...configuration,
      config: { ...configuration.config, publicIdentifiersConsistent },
    };
    if (!publicIdentifiersConsistent) {
      outcome = 'prerequisite_missing';
      findings.push({
        severity: 'error',
        summary: 'Deployed mobile identity proof is missing or does not match the loaded configuration',
      });
    }
  }

  return { configuration, outcome, findings };
}

async function runAutomatedPhase(
  args: M1VerifyArguments,
  dependencies: HarnessDependencies,
): Promise<M1Manifest> {
  const startedAt = safeDate(dependencies.now);
  const testedBehaviorCommit = await resolveTestedBehaviorCommit(dependencies);
  const commands: M1CommandResult[] = [];
  const evidence: M1EvidenceReference[] = [];
  const preflight = await evaluateMachinePreflight(args, dependencies, 'automated');
  const findings = preflight.findings;
  let configuration = preflight.configuration;
  let outcome = preflight.outcome;
  let forceRedactedFallback = false;

  // A prerequisite manifest is diagnostic only: it has no gate output or
  // evidence references and cannot be treated as passing verification.
  const context = await createMachineRunContext({
    repoRoot: dependencies.repoRoot,
    testedBehaviorCommit,
    baseRunId: createM1RunId(startedAt, 'automated'),
  });

  if (outcome === 'passed') {
    let workspace: ExecutionWorkspace | undefined;
    try {
      if (!configuration.loaded) {
        throw new M1HarnessError('Validated mobile build configuration is unexpectedly unavailable');
      }
      workspace = dependencies.createExecutionWorkspace
        ? await dependencies.createExecutionWorkspace({
            repoRoot: dependencies.repoRoot,
            testedBehaviorCommit,
          })
        : await createDetachedExecutionWorkspace({
            repoRoot: dependencies.repoRoot,
            testedBehaviorCommit,
          });

      const gateCommands = automatedCommands({
        dependencies,
        executionRoot: workspace.root,
        loaded: configuration.loaded,
      });
      for (const [commandIndex, spec] of gateCommands.entries()) {
        if (commandIndex === gateCommands.length - 1) {
          await stageCleanScannerInput({
            executionRoot: workspace.root,
            testedBehaviorCommit,
            runId: context.runId,
            config: configuration.config,
            commands,
          });
        }

        const commandStartedAt = safeDate(dependencies.now);
        const result = await dependencies.runCommand(spec);
        const commandEndedAt = safeDate(dependencies.now);
        if (!Number.isSafeInteger(result.exitCode)) {
          throw new M1HarnessError(`Command runner returned an invalid exit code for ${spec.label}`);
        }
        commands.push(
          createCommandResult({
            spec,
            repoRoot: workspace.root,
            startedAt: commandStartedAt,
            endedAt: commandEndedAt,
            exitCode: result.exitCode,
          }),
        );
        if (result.exitCode === 0) continue;

        // A failed gate never reaches the clean scanner. Retain only the
        // generic failed-gate finding; raw stdout/stderr must not cross from
        // the execution checkout into the original evidence tree unscreened.
        findings.push({ severity: 'error', summary: `Automated gate failed: ${spec.label}` });
        outcome = 'gate_failed';
        break;
      }
    } catch {
      forceRedactedFallback = true;
      outcome = 'harness_error';
      findings.push({
        severity: 'error',
        summary: 'The automated verification harness could not execute a gate safely',
      });
    } finally {
      if (workspace) {
        try {
          await workspace.dispose();
        } catch {
          forceRedactedFallback = true;
          outcome = 'harness_error';
          findings.push({
            severity: 'error',
            summary: 'The clean execution workspace could not be removed safely',
          });
        }
      }
    }
  }

  const finalTiming = safeFinalManifestTiming(dependencies.now, startedAt);
  const trustedFinalInput: TrustedAutomatedManifestInput = {
    context,
    testedBehaviorCommit,
    startedAt,
    endedAt: finalTiming.endedAt,
  };
  let manifest: M1Manifest;
  if (!finalTiming.isReliable) {
    manifest = createRedactedAutomatedManifest(
      trustedFinalInput,
      'The automated verification harness could not produce a valid final timestamp',
    );
  } else if (forceRedactedFallback) {
    manifest = createRedactedAutomatedManifest(
      trustedFinalInput,
      GENERIC_AUTOMATED_HARNESS_FAILURE,
    );
  } else {
    manifest = createSafeAutomatedManifest({
      context,
      testedBehaviorCommit,
      startedAt,
      endedAt: finalTiming.endedAt,
      outcome,
      config: configuration.config,
      platform: dependencies.platform,
      commands,
      evidence,
      findings,
    });
  }
  await writeManifest(context.directory, manifest);
  return manifest;
}

type SimulatorDiscovery = {
  alias: string;
  runtime: string;
};

type SimulatorManifestInput = {
  context: AutomaticRunContext;
  testedBehaviorCommit: string;
  startedAt: Date;
  endedAt: Date;
  outcome: M1Outcome;
  config: M1Manifest['config'];
  host: M1Manifest['host'];
  commands: M1CommandResult[];
  evidence: M1EvidenceReference[];
  findings: M1Manifest['findings'];
};

type TrustedSimulatorManifestInput = Pick<
  SimulatorManifestInput,
  'context' | 'testedBehaviorCommit' | 'startedAt' | 'endedAt'
>;

function boundedOutput(value: string): string {
  return value.slice(0, MAX_CAPTURED_OUTPUT_BYTES);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

function safeSimulatorHostValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    normalized === '' ||
    normalized.length > MAX_SIMULATOR_HOST_VALUE_LENGTH ||
    Array.from(normalized).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) ||
    containsUnsafeEvidenceText(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function safeSimulatorAlias(value: unknown): string | undefined {
  const alias = safeSimulatorHostValue(value);
  return alias && /^(?:iPhone|iPad|Apple Vision Pro)(?: [A-Za-z0-9._-]+)*$/u.test(alias)
    ? alias
    : undefined;
}

function safeSimulatorRuntime(value: unknown): string | undefined {
  const runtime = safeSimulatorHostValue(value);
  return runtime && /^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[A-Za-z0-9._-]+$/u.test(runtime)
    ? runtime
    : undefined;
}

/**
 * Parses only the requested available simulator's non-identifying display
 * name and runtime. The raw simctl JSON, including UDIDs and local paths,
 * remains in memory and is never copied into a manifest or finding.
 */
function discoverAvailableSimulator(output: string, requestedUdid: string): SimulatorDiscovery | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(boundedOutput(output));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const devices = (parsed as UnknownRecord).devices;
  if (typeof devices !== 'object' || devices === null || Array.isArray(devices)) return undefined;

  for (const [runtimeValue, candidates] of Object.entries(devices as UnknownRecord)) {
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
      const record = candidate as UnknownRecord;
      if (record.udid !== requestedUdid) continue;
      if (record.isAvailable !== true) return undefined;

      const alias = safeSimulatorAlias(record.name);
      const runtime = safeSimulatorRuntime(runtimeValue);
      return alias && runtime ? { alias, runtime } : undefined;
    }
  }

  return undefined;
}

function parseXcodeVersion(output: string): string | undefined {
  const firstLine = boundedOutput(output)
    .split(/\r?\n/u)
    .find((line) => line.trim() !== '');
  const match = firstLine?.trim().match(/^Xcode\s+([0-9]+(?:\.[0-9]+){0,2})(?:\s+\S.*)?$/u);
  return match?.[1];
}

type SafeSemver = {
  version: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
};

const SAFE_SEMVER_SOURCE =
  '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?';
const SAFE_SEMVER_PATTERN = new RegExp(`^${SAFE_SEMVER_SOURCE}$`, 'u');
const MINIMUM_BUN_VERSION: Pick<SafeSemver, 'major' | 'minor' | 'patch'> = {
  major: 1,
  minor: 3,
  patch: 1,
};

const MOBILE_DEPENDENCY_PROVENANCE = [
  { packageName: 'quasar', hostField: 'quasarVersion' },
  { packageName: '@capacitor/core', hostField: 'capacitorCoreVersion' },
  { packageName: '@capacitor/ios', hostField: 'capacitorIosVersion' },
  { packageName: '@capacitor/app', hostField: 'capacitorAppVersion' },
  { packageName: '@capacitor/keyboard', hostField: 'capacitorKeyboardVersion' },
] as const;

function parseSafeSemver(value: string): SafeSemver | undefined {
  if (value.length > MAX_SIMULATOR_HOST_VALUE_LENGTH) return undefined;

  const match = value.match(SAFE_SEMVER_PATTERN);
  if (!match) return undefined;

  const [, major, minor, patch, prerelease] = match;
  const numericVersion = [Number(major), Number(minor), Number(patch)];
  if (numericVersion.some((part) => !Number.isSafeInteger(part))) return undefined;

  return {
    version: value,
    major: numericVersion[0]!,
    minor: numericVersion[1]!,
    patch: numericVersion[2]!,
    prerelease,
  };
}

function isAtLeastMinimumBunVersion(version: SafeSemver): boolean {
  if (version.major !== MINIMUM_BUN_VERSION.major) {
    return version.major > MINIMUM_BUN_VERSION.major;
  }
  if (version.minor !== MINIMUM_BUN_VERSION.minor) {
    return version.minor > MINIMUM_BUN_VERSION.minor;
  }
  if (version.patch !== MINIMUM_BUN_VERSION.patch) {
    return version.patch > MINIMUM_BUN_VERSION.patch;
  }
  return version.prerelease === undefined;
}

function parseSafeBunVersion(output: string): string | undefined {
  const version = parseSafeSemver(boundedOutput(output).trim());
  return version && isAtLeastMinimumBunVersion(version) ? version.version : undefined;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseSafeDependencyVersion(output: string, packageName: string): string | undefined {
  const dependencyPattern = new RegExp(
    `(?:^|[^A-Za-z0-9@/._-])${escapeRegularExpression(packageName)}@(${SAFE_SEMVER_SOURCE})(?=$|\\s)`,
    'gmu',
  );
  const versions = new Set<string>();
  for (const match of boundedOutput(output).matchAll(dependencyPattern)) {
    const version = parseSafeSemver(match[1] ?? '');
    if (version) versions.add(version.version);
  }

  return versions.size === 1 ? Array.from(versions)[0] : undefined;
}

function parseMobileDependencyProvenance(input: {
  quasarOutput: string;
  capacitorOutput: string;
}): Pick<
  M1Manifest['host'],
  | 'quasarVersion'
  | 'capacitorCoreVersion'
  | 'capacitorIosVersion'
  | 'capacitorAppVersion'
  | 'capacitorKeyboardVersion'
> | undefined {
  const quasarVersion = parseSafeDependencyVersion(input.quasarOutput, 'quasar');
  const capacitorVersions = MOBILE_DEPENDENCY_PROVENANCE.slice(1).map(
    ({ packageName, hostField }) => [
      hostField,
      parseSafeDependencyVersion(input.capacitorOutput, packageName),
    ] as const,
  );
  if (!quasarVersion || capacitorVersions.some(([, version]) => !version)) return undefined;

  return {
    quasarVersion,
    capacitorCoreVersion: capacitorVersions[0]![1]!,
    capacitorIosVersion: capacitorVersions[1]![1]!,
    capacitorAppVersion: capacitorVersions[2]![1]!,
    capacitorKeyboardVersion: capacitorVersions[3]![1]!,
  };
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePathFromRoot = relative(resolve(root), resolve(candidate));
  return relativePathFromRoot !== '' && !relativePathFromRoot.startsWith('..');
}

function deriveSimulatorAppBundlePath(input: {
  output: string;
  derivedDataPath: string;
}): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(boundedOutput(input.output));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;

  const candidates = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const buildSettings = (item as UnknownRecord).buildSettings;
    if (typeof buildSettings !== 'object' || buildSettings === null || Array.isArray(buildSettings)) {
      continue;
    }
    const targetBuildDirectory = (buildSettings as UnknownRecord).TARGET_BUILD_DIR;
    const wrapperName = (buildSettings as UnknownRecord).WRAPPER_NAME;
    if (
      typeof targetBuildDirectory !== 'string' ||
      typeof wrapperName !== 'string' ||
      !/^[A-Za-z0-9_.-]+\.app$/u.test(wrapperName)
    ) {
      continue;
    }
    const appBundlePath = resolve(targetBuildDirectory, wrapperName);
    if (!isPathInside(input.derivedDataPath, appBundlePath)) continue;
    candidates.add(appBundlePath);
  }

  return candidates.size === 1 ? Array.from(candidates)[0] : undefined;
}

function safeRelativeSimulatorAppPath(workspaceRoot: string, appBundlePath: string): string | undefined {
  if (!isPathInside(workspaceRoot, appBundlePath)) return undefined;
  return safeSimulatorHostValue(relativePath(workspaceRoot, appBundlePath));
}

function parseExecutableName(output: string): string | undefined {
  const executable = boundedOutput(output).trim();
  return /^[A-Za-z0-9_.-]+$/u.test(executable) ? executable : undefined;
}

function processListIncludesExecutable(output: string, executable: string): boolean {
  return boundedOutput(output)
    .split(/\r?\n/u)
    .some((line) => basename(line.trim()) === executable);
}

async function runSimulatorCommand(input: {
  dependencies: HarnessDependencies;
  workspaceRoot: string;
  commands: M1CommandResult[];
  spec: CommandSpec;
}): Promise<Awaited<ReturnType<CommandRunner>>> {
  const startedAt = safeDate(input.dependencies.now);
  const result = await input.dependencies.runCommand(input.spec);
  const endedAt = safeDate(input.dependencies.now);
  if (!Number.isSafeInteger(result.exitCode)) {
    throw new M1HarnessError(`Command runner returned an invalid exit code for ${input.spec.label}`);
  }
  input.commands.push(
    createCommandResult({
      spec: input.spec,
      repoRoot: input.workspaceRoot,
      startedAt,
      endedAt,
      exitCode: result.exitCode,
    }),
  );
  return result;
}

function createSimulatorManifest(input: SimulatorManifestInput): M1Manifest {
  return validateM1Manifest({
    schemaVersion: 1,
    runId: input.context.runId,
    testedBehaviorCommit: input.testedBehaviorCommit,
    phase: 'ios-simulator',
    matrixClass: 'automated',
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    outcome: input.outcome,
    exitCode: M1_EXIT_CODE[input.outcome],
    config: input.config,
    host: input.host,
    commands: input.commands,
    evidence: input.evidence,
    findings: input.findings,
  });
}

function createRedactedSimulatorManifest(
  input: TrustedSimulatorManifestInput,
  summary: string,
): M1Manifest {
  const { startedAt, endedAt } = normalizedFallbackManifestTimes(input);
  return validateM1Manifest({
    schemaVersion: 1,
    runId: input.context.runId,
    testedBehaviorCommit: input.testedBehaviorCommit,
    phase: 'ios-simulator',
    matrixClass: 'automated',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    outcome: 'harness_error',
    exitCode: M1_EXIT_CODE.harness_error,
    config: redactedMissingConfiguration(),
    host: {},
    commands: [],
    evidence: [],
    findings: [{ severity: 'error', summary }],
  });
}

function createSafeSimulatorManifest(input: SimulatorManifestInput): M1Manifest {
  const trustedInput: TrustedSimulatorManifestInput = {
    context: input.context,
    testedBehaviorCommit: input.testedBehaviorCommit,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  };

  try {
    const manifest = createSimulatorManifest(input);
    const { testedBehaviorCommit: _testedBehaviorCommit, ...content } = manifest;
    if (!containsUnsafeEvidenceText(JSON.stringify(content))) return manifest;
    return createRedactedSimulatorManifest(
      trustedInput,
      'The iOS Simulator verification manifest contained prohibited sensitive content',
    );
  } catch {
    return createRedactedSimulatorManifest(
      trustedInput,
      'The iOS Simulator verification manifest could not be serialized safely',
    );
  }
}

/**
 * Builds and launches the exact committed WebView artifact on one explicitly
 * selected Simulator. The UDID is only an in-memory command argument: it is
 * absent from command records, host fields, findings, and evidence metadata.
 */
async function runIosSimulatorPhase(
  args: M1VerifyArguments,
  dependencies: HarnessDependencies,
): Promise<M1Manifest> {
  const startedAt = safeDate(dependencies.now);
  const testedBehaviorCommit = await resolveTestedBehaviorCommit(dependencies);
  const commands: M1CommandResult[] = [];
  const evidence: M1EvidenceReference[] = [];
  const preflight = await evaluateMachinePreflight(args, dependencies, 'iOS Simulator');
  const findings = preflight.findings;
  const host: M1Manifest['host'] = {};
  let configuration = preflight.configuration;
  let outcome = preflight.outcome;
  let forceRedactedFallback = false;

  if (outcome === 'passed' && dependencies.platform !== 'darwin') {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'iOS Simulator verification requires macOS',
    });
  }
  if (outcome === 'passed' && !args.simulatorUdid) {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'An explicit iOS Simulator identifier is required',
    });
  }

  const context = await createMachineRunContext({
    repoRoot: dependencies.repoRoot,
    testedBehaviorCommit,
    baseRunId: `${createM1RunId(startedAt, 'automated')}-ios-simulator`,
  });

  if (outcome === 'passed') {
    let workspace: ExecutionWorkspace | undefined;
    let simulatorWorkStarted = false;
    let simulatorExecutionRoot: string | undefined;
    let simulatorCommandEnv: Record<string, string> | undefined;
    try {
      if (!configuration.loaded || !args.simulatorUdid) {
        throw new M1HarnessError('Validated Simulator inputs are unexpectedly unavailable');
      }
      workspace = dependencies.createExecutionWorkspace
        ? await dependencies.createExecutionWorkspace({
            repoRoot: dependencies.repoRoot,
            testedBehaviorCommit,
          })
        : await createDetachedExecutionWorkspace({
            repoRoot: dependencies.repoRoot,
            testedBehaviorCommit,
          });

      const executionRoot = workspace.root;
      const mobileRoot = join(executionRoot, 'apps/vela-mobile');
      const capacitorRoot = join(mobileRoot, 'src-capacitor');
      const xcodeWorkspace = join(capacitorRoot, 'ios/App/App.xcworkspace');
      const wwwRoot = join(capacitorRoot, 'www');
      const derivedDataPath = join(
        executionRoot,
        SIMULATOR_DERIVED_DATA_DIRECTORY,
        context.runId,
        'DerivedData',
      );
      const xcodeBuildArguments = [
        '-workspace',
        xcodeWorkspace,
        '-scheme',
        'App',
        '-configuration',
        'Release',
        '-sdk',
        'iphonesimulator',
        '-destination',
        `platform=iOS Simulator,id=${args.simulatorUdid}`,
        '-derivedDataPath',
        derivedDataPath,
      ];
      const commandEnv = commandEnvironment(
        configuration.loaded,
        dependencies.executionProcessEnvironment ?? process.env,
      );
      simulatorExecutionRoot = executionRoot;
      simulatorCommandEnv = commandEnv;
      const runStep = async (input: {
        spec: CommandSpec;
        failureOutcome: 'prerequisite_missing' | 'gate_failed';
        summary: string;
      }) => {
        const result = await runSimulatorCommand({
          dependencies,
          workspaceRoot: executionRoot,
          commands,
          spec: input.spec,
        });
        if (result.exitCode !== 0) {
          outcome = input.failureOutcome;
          findings.push({ severity: 'error', summary: input.summary });
          return undefined;
        }
        return result;
      };

      const xcodeVersionResult = await runStep({
        spec: {
          label: 'xcode-version',
          command: 'xcodebuild',
          args: ['-version'],
          cwd: executionRoot,
          env: commandEnv,
        },
        failureOutcome: 'prerequisite_missing',
        summary: 'Xcode is unavailable for iOS Simulator verification',
      });
      if (xcodeVersionResult) {
        const xcodeVersion = parseXcodeVersion(xcodeVersionResult.stdout);
        if (!xcodeVersion) {
          outcome = 'prerequisite_missing';
          findings.push({ severity: 'error', summary: 'Xcode version output could not be verified safely' });
        } else {
          host.xcodeVersion = xcodeVersion;
        }
      }

      if (outcome === 'passed') {
        const bunVersionResult = await runStep({
          spec: {
            label: 'bun-version',
            command: 'bun',
            args: ['--version'],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'prerequisite_missing',
          summary: 'Bun is unavailable for iOS Simulator verification',
        });
        if (bunVersionResult) {
          const bunVersion = parseSafeBunVersion(bunVersionResult.stdout);
          if (!bunVersion) {
            outcome = 'prerequisite_missing';
            findings.push({
              severity: 'error',
              summary: 'Bun version must satisfy the required minimum of 1.3.1',
            });
          } else {
            host.bunVersion = bunVersion;
          }
        }
      }

      if (outcome === 'passed') {
        await runStep({
          spec: {
            label: 'simulator-dependency-install',
            command: 'bun',
            args: ['install', '--frozen-lockfile'],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Clean iOS Simulator dependency installation failed',
        });
      }

      if (outcome === 'passed') {
        const quasarDependencyResult = await runStep({
          spec: {
            label: 'quasar-dependency-version',
            command: 'bun',
            args: ['pm', 'ls', '--all', 'quasar'],
            cwd: mobileRoot,
            env: commandEnv,
          },
          failureOutcome: 'prerequisite_missing',
          summary: 'Quasar version could not be verified',
        });
        if (quasarDependencyResult) {
          const capacitorDependencyResult = await runStep({
            spec: {
              label: 'capacitor-dependency-versions',
              command: 'bun',
              args: [
                'pm',
                'ls',
                '@capacitor/core',
                '@capacitor/ios',
                '@capacitor/app',
                '@capacitor/keyboard',
              ],
              cwd: capacitorRoot,
              env: commandEnv,
            },
            failureOutcome: 'prerequisite_missing',
            summary: 'Capacitor dependency versions could not be verified',
          });
          if (capacitorDependencyResult) {
            const dependencyProvenance = parseMobileDependencyProvenance({
              quasarOutput: quasarDependencyResult.stdout,
              capacitorOutput: capacitorDependencyResult.stdout,
            });
            if (!dependencyProvenance) {
              outcome = 'prerequisite_missing';
              findings.push({
                severity: 'error',
                summary: 'Key mobile dependency versions could not be verified safely',
              });
            } else {
              Object.assign(host, dependencyProvenance);
            }
          }
        }
      }

      if (outcome === 'passed') {
        const discoveryResult = await runStep({
          spec: {
            label: 'simulator-discovery',
            command: 'xcrun',
            args: ['simctl', 'list', 'devices', 'available', '--json'],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'prerequisite_missing',
          summary: 'Available iOS Simulators could not be discovered',
        });
        if (discoveryResult) {
          const simulator = discoverAvailableSimulator(discoveryResult.stdout, args.simulatorUdid);
          if (!simulator) {
            outcome = 'prerequisite_missing';
            findings.push({
              severity: 'error',
              summary: 'The requested iOS Simulator or runtime is unavailable',
            });
          } else {
            host.simulatorAlias = simulator.alias;
            host.simulatorRuntime = simulator.runtime;
          }
        }
      }

      if (outcome === 'passed') {
        await runStep({
          spec: {
            label: 'production-diagnostics',
            command: 'bun',
            args: ['run', '--cwd', 'apps/vela-mobile', 'verify:production-diagnostics'],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Production diagnostics failed before iOS Simulator build',
        });
      }

      let wwwHashBefore: string | undefined;
      if (outcome === 'passed') {
        try {
          wwwHashBefore = await hashDirectory(wwwRoot);
          host.wwwHashBefore = wwwHashBefore;
        } catch {
          outcome = 'gate_failed';
          findings.push({
            severity: 'error',
            summary: 'Verified production WebView assets could not be hashed',
          });
        }
      }

      if (outcome === 'passed') {
        await runStep({
          spec: {
            label: 'capacitor-sync-ios',
            command: 'bunx',
            args: ['cap', 'sync', 'ios'],
            cwd: capacitorRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Capacitor iOS sync failed after production asset verification',
        });
      }

      if (outcome === 'passed' && wwwHashBefore) {
        try {
          const wwwHashAfter = await hashDirectory(wwwRoot);
          host.wwwHashAfter = wwwHashAfter;
          if (wwwHashAfter !== wwwHashBefore) {
            outcome = 'gate_failed';
            findings.push({
              severity: 'error',
              summary: 'cap sync changed verified WebView assets',
            });
          }
        } catch {
          outcome = 'gate_failed';
          findings.push({
            severity: 'error',
            summary: 'WebView assets could not be re-hashed after Capacitor sync',
          });
        }
      }

      let appBundlePath: string | undefined;
      if (outcome === 'passed') {
        const buildSettingsResult = await runStep({
          spec: {
            label: 'simulator-build-settings',
            command: 'xcodebuild',
            args: ['-showBuildSettings', '-json', ...xcodeBuildArguments],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Simulator app build settings could not be resolved',
        });
        if (buildSettingsResult) {
          appBundlePath = deriveSimulatorAppBundlePath({
            output: buildSettingsResult.stdout,
            derivedDataPath,
          });
          const relativeAppBundlePath = appBundlePath
            ? safeRelativeSimulatorAppPath(executionRoot, appBundlePath)
            : undefined;
          if (!appBundlePath || !relativeAppBundlePath) {
            outcome = 'gate_failed';
            findings.push({
              severity: 'error',
              summary: 'Simulator app bundle path could not be derived safely',
            });
          } else {
            host.appBundlePath = relativeAppBundlePath;
          }
        }
      }

      if (outcome === 'passed') {
        await runStep({
          spec: {
            label: 'simulator-build',
            command: 'xcodebuild',
            args: [...xcodeBuildArguments, 'CODE_SIGNING_ALLOWED=NO', 'build'],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Unsigned iOS Simulator build failed',
        });
      }

      let executable: string | undefined;
      if (outcome === 'passed' && appBundlePath) {
        const executableResult = await runStep({
          spec: {
            label: 'simulator-executable',
            command: 'plutil',
            args: ['-extract', 'CFBundleExecutable', 'raw', join(appBundlePath, 'Info.plist')],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Simulator app executable could not be read from Info.plist',
        });
        if (executableResult) {
          executable = parseExecutableName(executableResult.stdout);
          if (!executable) {
            outcome = 'gate_failed';
            findings.push({
              severity: 'error',
              summary: 'Simulator app executable name could not be verified safely',
            });
          }
        }
      }

      if (outcome === 'passed') {
        simulatorWorkStarted = true;
        await runStep({
          spec: {
            label: 'simulator-bootstatus',
            command: 'xcrun',
            args: ['simctl', 'bootstatus', args.simulatorUdid, '-b'],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Requested iOS Simulator could not be booted',
        });
      }

      if (outcome === 'passed' && appBundlePath) {
        await runStep({
          spec: {
            label: 'simulator-install',
            command: 'xcrun',
            args: ['simctl', 'install', args.simulatorUdid, appBundlePath],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Simulator app installation failed',
        });
      }

      if (outcome === 'passed') {
        await runStep({
          spec: {
            label: 'simulator-launch',
            command: 'xcrun',
            args: ['simctl', 'launch', args.simulatorUdid, 'com.vela.app'],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Simulator app launch failed',
        });
      }

      if (outcome === 'passed' && executable) {
        await (dependencies.sleep ?? delay)(SIMULATOR_PROCESS_CHECK_DELAY_MS);
        const processResult = await runStep({
          spec: {
            label: 'simulator-process-list',
            command: 'xcrun',
            args: ['simctl', 'spawn', args.simulatorUdid, '/bin/ps', '-A', '-o', 'comm='],
            cwd: executionRoot,
            env: commandEnv,
          },
          failureOutcome: 'gate_failed',
          summary: 'Simulator process list could not be inspected',
        });
        if (processResult && !processListIncludesExecutable(processResult.stdout, executable)) {
          outcome = 'gate_failed';
          findings.push({
            severity: 'error',
            summary: 'Launched simulator app process was not present after the bounded wait',
          });
        }
      }
    } catch {
      forceRedactedFallback = true;
      outcome = 'harness_error';
    } finally {
      if (workspace) {
        try {
          await workspace.dispose();
        } catch {
          forceRedactedFallback = true;
          outcome = 'harness_error';
        }
      }
      if (simulatorWorkStarted && args.simulatorUdid) {
        const cleanupRoot = simulatorExecutionRoot ?? dependencies.repoRoot;
        const cleanupEnv = simulatorCommandEnv;
        const cleanupSpec = (label: string, simctlArgs: string[]): CommandSpec => ({
          label,
          command: 'xcrun',
          args: simctlArgs,
          cwd: cleanupRoot,
          ...(cleanupEnv ? { env: cleanupEnv } : {}),
        });
        try {
          await dependencies.runCommand(
            cleanupSpec('simulator-cleanup-uninstall', [
              'simctl',
              'uninstall',
              args.simulatorUdid,
              'com.vela.app',
            ]),
          );
        } catch {
          // Best-effort cleanup: uninstall failures must not change outcome or findings.
        }
        try {
          await dependencies.runCommand(
            cleanupSpec('simulator-cleanup-shutdown', ['simctl', 'shutdown', args.simulatorUdid]),
          );
        } catch {
          // Best-effort cleanup: shutdown failures must not change outcome or findings.
        }
      }
    }
  }

  const finalTiming = safeFinalManifestTiming(dependencies.now, startedAt);
  const trustedFinalInput: TrustedSimulatorManifestInput = {
    context,
    testedBehaviorCommit,
    startedAt,
    endedAt: finalTiming.endedAt,
  };
  let manifest: M1Manifest;
  if (!finalTiming.isReliable) {
    manifest = createRedactedSimulatorManifest(
      trustedFinalInput,
      'The iOS Simulator verification harness could not produce a valid final timestamp',
    );
  } else if (forceRedactedFallback) {
    manifest = createRedactedSimulatorManifest(
      trustedFinalInput,
      'The iOS Simulator verification harness could not execute safely',
    );
  } else {
    manifest = createSafeSimulatorManifest({
      context,
      testedBehaviorCommit,
      startedAt,
      endedAt: finalTiming.endedAt,
      outcome,
      config: configuration.config,
      host,
      commands,
      evidence,
      findings,
    });
  }
  await writeManifest(context.directory, manifest);
  return manifest;
}

type PhysicalDeviceSummary = {
  alias: string;
  model: string;
  available: boolean;
  trusted: boolean;
  developerMode: boolean;
};

type PhysicalManifestInput = {
  context: AutomaticRunContext;
  testedBehaviorCommit: string;
  startedAt: Date;
  endedAt: Date;
  outcome: M1Outcome;
  config: M1Manifest['config'];
  host: M1Manifest['host'];
  commands: M1CommandResult[];
  evidence: M1EvidenceReference[];
  findings: M1Manifest['findings'];
};

type TrustedPhysicalManifestInput = Pick<
  PhysicalManifestInput,
  'context' | 'testedBehaviorCommit' | 'startedAt' | 'endedAt'
>;

type PhysicalStateField = {
  key: string;
  acceptsBoolean: boolean;
  trueValues?: ReadonlySet<string>;
  falseValues?: ReadonlySet<string>;
};

const PHYSICAL_AVAILABILITY_FIELDS: readonly PhysicalStateField[] = [
  { key: 'available', acceptsBoolean: true },
  { key: 'isAvailable', acceptsBoolean: true },
  {
    key: 'availability',
    acceptsBoolean: false,
    trueValues: new Set(['available']),
    falseValues: new Set(['unavailable']),
  },
  { key: 'isConnected', acceptsBoolean: true },
  {
    key: 'connectionState',
    acceptsBoolean: false,
    trueValues: new Set(['connected', 'online']),
    falseValues: new Set(['disconnected', 'offline']),
  },
  {
    key: 'bootState',
    acceptsBoolean: false,
    trueValues: new Set(['booted']),
    falseValues: new Set(['shutdown']),
  },
];

const PHYSICAL_TRUST_FIELDS: readonly PhysicalStateField[] = [
  { key: 'trusted', acceptsBoolean: true },
  { key: 'isTrusted', acceptsBoolean: true },
  {
    key: 'trustState',
    acceptsBoolean: false,
    trueValues: new Set(['trusted']),
    falseValues: new Set(['untrusted']),
  },
  {
    key: 'authenticationState',
    acceptsBoolean: false,
    trueValues: new Set(['trusted']),
    falseValues: new Set(['untrusted']),
  },
];

const PHYSICAL_DEVELOPER_MODE_FIELDS: readonly PhysicalStateField[] = [
  { key: 'developerMode', acceptsBoolean: true },
  { key: 'developerModeEnabled', acceptsBoolean: true },
  {
    key: 'developerModeStatus',
    acceptsBoolean: false,
    trueValues: new Set(['enabled']),
    falseValues: new Set(['disabled']),
  },
];

function asUnknownRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function nestedRecord(record: UnknownRecord, key: string): UnknownRecord | undefined {
  return asUnknownRecord(record[key]);
}

function firstStringValue(records: readonly UnknownRecord[], keys: readonly string[]): string | undefined {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}

function normalizedPhysicalStateValue(
  value: unknown,
  field: PhysicalStateField,
): boolean | undefined {
  if (typeof value === 'boolean') return field.acceptsBoolean ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (field.trueValues?.has(normalized)) return true;
  if (field.falseValues?.has(normalized)) return false;
  return undefined;
}

function consistentPhysicalStateValue(input: {
  records: readonly UnknownRecord[];
  fields: readonly PhysicalStateField[];
}): boolean | undefined {
  let resolved: boolean | undefined;
  for (const record of input.records) {
    for (const field of input.fields) {
      if (!Object.prototype.hasOwnProperty.call(record, field.key)) continue;
      const value = normalizedPhysicalStateValue(record[field.key], field);
      if (value === undefined) return undefined;
      if (resolved !== undefined && resolved !== value) return undefined;
      resolved = value;
    }
  }
  return resolved;
}

function safePhysicalHostValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (
    normalized === '' ||
    normalized.length > MAX_SIMULATOR_HOST_VALUE_LENGTH ||
    Array.from(normalized).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) ||
    containsUnsafeEvidenceText(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

function safePhysicalDeviceAlias(value: unknown): string | undefined {
  const alias = safePhysicalHostValue(value);
  return alias && /^(?:iPhone|iPad|iPod touch)(?: [A-Za-z0-9._-]+)*$/u.test(alias)
    ? alias
    : undefined;
}

function safePhysicalDeviceModel(value: unknown): string | undefined {
  const model = safePhysicalHostValue(value);
  return model && /^(?:iPhone|iPad|iPod)(?:[A-Za-z0-9,._ -]+)?$/u.test(model) ? model : undefined;
}

function physicalDeviceCandidates(parsed: unknown): UnknownRecord[] | undefined {
  const root = asUnknownRecord(parsed);
  if (!root) return undefined;
  const result = nestedRecord(root, 'result');
  const candidates = result?.devices ?? root.devices;
  if (!Array.isArray(candidates)) return undefined;

  const records: UnknownRecord[] = [];
  for (const candidate of candidates) {
    const record = asUnknownRecord(candidate);
    if (!record) return undefined;
    records.push(record);
  }
  return records;
}

/**
 * Parses a CoreDevice list only in memory. The requested identifier is used
 * solely to choose the device; the return value intentionally has no field
 * capable of carrying that identifier or any other raw discovery detail.
 */
function discoverPhysicalDevice(
  rawDeviceList: string,
  requestedDeviceId: string,
): PhysicalDeviceSummary | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawDeviceList);
  } catch {
    return undefined;
  }

  const candidates = physicalDeviceCandidates(parsed);
  if (!candidates) return undefined;

  const matchingCandidates = candidates.filter((candidate) =>
    ['identifier', 'udid', 'deviceIdentifier', 'id'].some(
      (key) => candidate[key] === requestedDeviceId,
    ),
  );
  if (matchingCandidates.length !== 1) return undefined;

  const candidate = matchingCandidates[0]!;
  const deviceProperties = nestedRecord(candidate, 'deviceProperties');
  const connectionProperties = nestedRecord(candidate, 'connectionProperties');
  const hardwareProperties = nestedRecord(candidate, 'hardwareProperties');
  const available = consistentPhysicalStateValue({
    records: [candidate, ...(deviceProperties ? [deviceProperties] : []), ...(connectionProperties ? [connectionProperties] : [])],
    fields: PHYSICAL_AVAILABILITY_FIELDS,
  });
  const trusted = consistentPhysicalStateValue({
    records: [candidate, ...(connectionProperties ? [connectionProperties] : [])],
    fields: PHYSICAL_TRUST_FIELDS,
  });
  const developerMode = consistentPhysicalStateValue({
    records: [candidate, ...(deviceProperties ? [deviceProperties] : [])],
    fields: PHYSICAL_DEVELOPER_MODE_FIELDS,
  });
  const alias = safePhysicalDeviceAlias(
    firstStringValue(
      [candidate, ...(deviceProperties ? [deviceProperties] : [])],
      ['name', 'deviceName'],
    ),
  );
  const model = safePhysicalDeviceModel(
    firstStringValue(
      [candidate, ...(hardwareProperties ? [hardwareProperties] : [])],
      ['model', 'modelName', 'deviceType', 'productType'],
    ),
  );

  if (
    available === undefined ||
    trusted === undefined ||
    developerMode === undefined ||
    !alias ||
    !model
  ) {
    return undefined;
  }

  return { alias, model, available, trusted, developerMode };
}

async function readPhysicalDeviceList(input: {
  path: string;
  requestedDeviceId: string;
}): Promise<PhysicalDeviceSummary | undefined> {
  try {
    const metadata = await stat(input.path);
    if (!metadata.isFile() || metadata.size > MAX_PHYSICAL_DEVICE_JSON_BYTES) return undefined;
    return discoverPhysicalDevice(await readFile(input.path, 'utf8'), input.requestedDeviceId);
  } catch {
    return undefined;
  }
}

/**
 * Treats unresolved, manual, or differently-targeted signing as a local
 * prerequisite. The team value is read only to establish non-emptiness and
 * is never returned, recorded, or included in a finding.
 */
function hasReadyPhysicalSigning(output: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(boundedOutput(output));
  } catch {
    return false;
  }
  if (!Array.isArray(parsed)) return false;

  const settings = parsed
    .map((item) => asUnknownRecord(item))
    .map((item) => (item ? nestedRecord(item, 'buildSettings') : undefined))
    .filter((item): item is UnknownRecord => item !== undefined);
  if (settings.length !== 1) return false;

  const buildSettings = settings[0]!;
  const codeSignStyle = buildSettings.CODE_SIGN_STYLE;
  const developmentTeam = buildSettings.DEVELOPMENT_TEAM;
  const bundleIdentifier = buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
  return (
    typeof codeSignStyle === 'string' &&
    codeSignStyle.trim() === 'Automatic' &&
    typeof developmentTeam === 'string' &&
    developmentTeam.trim() !== '' &&
    typeof bundleIdentifier === 'string' &&
    bundleIdentifier.trim() === 'com.vela.app'
  );
}

function createPhysicalManifest(input: PhysicalManifestInput): M1Manifest {
  return validateM1Manifest({
    schemaVersion: 1,
    runId: input.context.runId,
    testedBehaviorCommit: input.testedBehaviorCommit,
    phase: 'ios-physical-preflight',
    matrixClass: 'physical-preflight',
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    outcome: input.outcome,
    exitCode: M1_EXIT_CODE[input.outcome],
    config: input.config,
    host: input.host,
    commands: input.commands,
    evidence: input.evidence,
    findings: input.findings,
  });
}

function createRedactedPhysicalManifest(
  input: TrustedPhysicalManifestInput,
  summary: string,
): M1Manifest {
  const { startedAt, endedAt } = normalizedFallbackManifestTimes(input);
  return validateM1Manifest({
    schemaVersion: 1,
    runId: input.context.runId,
    testedBehaviorCommit: input.testedBehaviorCommit,
    phase: 'ios-physical-preflight',
    matrixClass: 'physical-preflight',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    outcome: 'harness_error',
    exitCode: M1_EXIT_CODE.harness_error,
    config: redactedMissingConfiguration(),
    host: {},
    commands: [],
    evidence: [],
    findings: [{ severity: 'error', summary }],
  });
}

function createSafePhysicalManifest(input: PhysicalManifestInput): M1Manifest {
  const trustedInput: TrustedPhysicalManifestInput = {
    context: input.context,
    testedBehaviorCommit: input.testedBehaviorCommit,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
  };

  try {
    const manifest = createPhysicalManifest(input);
    const { testedBehaviorCommit: _testedBehaviorCommit, ...content } = manifest;
    if (!containsUnsafeEvidenceText(JSON.stringify(content))) return manifest;
    return createRedactedPhysicalManifest(
      trustedInput,
      'The iOS physical-device preflight manifest contained prohibited sensitive content',
    );
  } catch {
    return createRedactedPhysicalManifest(
      trustedInput,
      'The iOS physical-device preflight manifest could not be serialized safely',
    );
  }
}

/**
 * Verifies only the non-product prerequisites for a tester-controlled
 * physical iPhone. Discovery JSON and signing output stay local and are
 * reduced to a non-identifying alias/model and one signing-ready boolean.
 */
async function runIosPhysicalPreflightPhase(
  args: M1VerifyArguments,
  dependencies: HarnessDependencies,
): Promise<M1Manifest> {
  const startedAt = safeDate(dependencies.now);
  const testedBehaviorCommit = await resolveTestedBehaviorCommit(dependencies);
  const commands: M1CommandResult[] = [];
  const evidence: M1EvidenceReference[] = [];
  const preflight = await evaluateMachinePreflight(args, dependencies, 'iOS physical-device');
  const findings = preflight.findings;
  const host: M1Manifest['host'] = {};
  let configuration = preflight.configuration;
  let outcome = preflight.outcome;
  let forceRedactedFallback = false;

  if (outcome === 'passed' && dependencies.platform !== 'darwin') {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'iOS physical-device verification requires macOS',
    });
  }
  if (outcome === 'passed' && !args.deviceId) {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'An explicit physical iOS device identifier is required',
    });
  }

  const context = await createMachineRunContext({
    repoRoot: dependencies.repoRoot,
    testedBehaviorCommit,
    baseRunId: createM1RunId(startedAt, 'physical-preflight'),
  });

  if (outcome === 'passed') {
    let workspace: ExecutionWorkspace | undefined;
    let rawDeviceOutputDirectory: string | undefined;
    try {
      if (!configuration.loaded || !args.deviceId) {
        throw new M1HarnessError('Validated physical preflight inputs are unexpectedly unavailable');
      }
      workspace = dependencies.createExecutionWorkspace
        ? await dependencies.createExecutionWorkspace({
            repoRoot: dependencies.repoRoot,
            testedBehaviorCommit,
          })
        : await createDetachedExecutionWorkspace({
            repoRoot: dependencies.repoRoot,
            testedBehaviorCommit,
          });

      const executionRoot = workspace.root;
      const xcodeWorkspace = join(executionRoot, 'apps/vela-mobile/src-capacitor/ios/App/App.xcworkspace');
      const commandEnv = commandEnvironment(
        configuration.loaded,
        dependencies.executionProcessEnvironment ?? process.env,
      );
      const runStep = async (input: { spec: CommandSpec; summary: string }) => {
        const result = await runSimulatorCommand({
          dependencies,
          workspaceRoot: executionRoot,
          commands,
          spec: input.spec,
        });
        if (result.exitCode !== 0) {
          outcome = 'prerequisite_missing';
          findings.push({ severity: 'error', summary: input.summary });
          return undefined;
        }
        return result;
      };

      rawDeviceOutputDirectory = await mkdtemp(join(tmpdir(), PHYSICAL_DEVICE_TEMPORARY_PREFIX));
      const rawDeviceOutputPath = join(rawDeviceOutputDirectory, 'devices.json');
      const deviceDiscoveryResult = await runStep({
        spec: {
          label: 'physical-device-discovery',
          command: 'xcrun',
          args: ['devicectl', 'list', 'devices', '--json-output', rawDeviceOutputPath],
          cwd: executionRoot,
          env: commandEnv,
        },
        summary: 'Physical iOS devices could not be discovered',
      });

      let device: PhysicalDeviceSummary | undefined;
      if (deviceDiscoveryResult) {
        device = await readPhysicalDeviceList({
          path: rawDeviceOutputPath,
          requestedDeviceId: args.deviceId,
        });
        if (!device) {
          outcome = 'prerequisite_missing';
          findings.push({
            severity: 'error',
            summary: 'The requested physical iOS device could not be verified safely',
          });
        } else if (!device.available) {
          outcome = 'prerequisite_missing';
          findings.push({ severity: 'error', summary: 'The requested physical iOS device is unavailable' });
        } else if (!device.trusted) {
          outcome = 'prerequisite_missing';
          findings.push({ severity: 'error', summary: 'The requested physical iOS device is not trusted' });
        } else if (!device.developerMode) {
          outcome = 'prerequisite_missing';
          findings.push({
            severity: 'error',
            summary: 'Developer Mode is disabled on the requested physical iOS device',
          });
        } else {
          host.deviceAlias = device.alias;
          host.deviceModel = device.model;
        }
      }

      if (outcome === 'passed') {
        const signingResult = await runStep({
          spec: {
            label: 'physical-signing-settings',
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
              `id=${args.deviceId}`,
            ],
            cwd: executionRoot,
            env: commandEnv,
          },
          summary: 'Physical iOS signing settings could not be resolved',
        });
        host.signingReady = signingResult ? hasReadyPhysicalSigning(signingResult.stdout) : false;
        if (signingResult && !host.signingReady) {
          outcome = 'prerequisite_missing';
          findings.push({
            severity: 'error',
            summary: 'Physical iOS signing readiness is incomplete or invalid',
          });
        }
      }
    } catch {
      forceRedactedFallback = true;
      outcome = 'harness_error';
    } finally {
      if (rawDeviceOutputDirectory) {
        try {
          await rm(rawDeviceOutputDirectory, { force: true, recursive: true });
        } catch {
          forceRedactedFallback = true;
          outcome = 'harness_error';
        }
      }
      if (workspace) {
        try {
          await workspace.dispose();
        } catch {
          forceRedactedFallback = true;
          outcome = 'harness_error';
        }
      }
    }
  }

  const finalTiming = safeFinalManifestTiming(dependencies.now, startedAt);
  const trustedFinalInput: TrustedPhysicalManifestInput = {
    context,
    testedBehaviorCommit,
    startedAt,
    endedAt: finalTiming.endedAt,
  };
  let manifest: M1Manifest;
  if (!finalTiming.isReliable) {
    manifest = createRedactedPhysicalManifest(
      trustedFinalInput,
      'The iOS physical-device preflight harness could not produce a valid final timestamp',
    );
  } else if (forceRedactedFallback) {
    manifest = createRedactedPhysicalManifest(
      trustedFinalInput,
      'The iOS physical-device preflight harness could not execute safely',
    );
  } else {
    manifest = createSafePhysicalManifest({
      context,
      testedBehaviorCommit,
      startedAt,
      endedAt: finalTiming.endedAt,
      outcome,
      config: configuration.config,
      host,
      commands,
      evidence,
      findings,
    });
  }
  await writeManifest(context.directory, manifest);
  return manifest;
}

function assertRecord(value: unknown): asserts value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new M1UsageError('Manual input must be a JSON object');
  }
}

function assertOnlyKeys(value: UnknownRecord, allowedKeys: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new M1UsageError('Manual input contains unsupported fields');
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function assertManualTextIsSafe(text: string): void {
  if (containsUnsafeEvidenceText(text)) {
    throw new M1UsageError('Manual input contains prohibited sensitive content');
  }
}

function assertManualHostIsSafe(host: unknown): void {
  assertRecord(host);
  for (const [key, value] of Object.entries(host)) {
    if (
      /(?:email|udid|device[_-]?(?:id|identifier)|identifier|token|secret|password|authorization|oauth|callback|code[_-]?(?:verifier)?|nonce)/iu.test(
        key,
      )
    ) {
      throw new M1UsageError('Manual input host fields must not include sensitive identifiers');
    }
    if (typeof value === 'string') assertManualTextIsSafe(value);
  }
}

function assertManualEvidenceIsSafe(evidence: unknown): void {
  if (!Array.isArray(evidence)) return;
  for (const item of evidence) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const record = item as UnknownRecord;
    if (typeof record.location === 'string') {
      assertManualTextIsSafe(record.location);
      if (record.location.toLowerCase().startsWith('data:')) {
        throw new M1UsageError('Manual input must reference binary evidence by hash, not inline data');
      }
    }
    if (
      typeof record.mediaType === 'string' &&
      /^(?:image|video|audio)\//iu.test(record.mediaType) &&
      typeof record.sha256 !== 'string'
    ) {
      throw new M1UsageError('Binary manual evidence requires a SHA-256 digest');
    }
  }
}

function parseManualInput(value: unknown): ManualInput {
  assertRecord(value);
  assertOnlyKeys(value, [
    'runId',
    'startedAt',
    'endedAt',
    'config',
    'host',
    'evidence',
    'findings',
    'outcome',
  ]);

  assertManualHostIsSafe(value.host);
  assertManualEvidenceIsSafe(value.evidence);
  assertManualTextIsSafe(JSON.stringify(value));

  return {
    runId: value.runId as string,
    startedAt: value.startedAt as string,
    endedAt: value.endedAt as string,
    config: value.config as M1Manifest['config'],
    host: value.host as M1Manifest['host'],
    evidence: value.evidence as M1EvidenceReference[],
    findings: value.findings as M1Manifest['findings'],
    outcome: value.outcome as ManualInput['outcome'],
  };
}

async function readManualInput(inputPath: string): Promise<ManualInput> {
  let bytes: Buffer;
  try {
    const metadata = await stat(inputPath);
    if (!metadata.isFile() || metadata.size > MAX_MANUAL_INPUT_BYTES) {
      throw new M1UsageError('Manual input must be a bounded JSON file');
    }
    bytes = await readFile(inputPath);
  } catch (error) {
    if (error instanceof M1UsageError) throw error;
    throw new M1UsageError('Unable to read the manual input JSON file');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(MANUAL_INPUT_DECODER.decode(bytes));
  } catch {
    throw new M1UsageError('Manual input must be valid UTF-8 JSON');
  }

  return parseManualInput(parsed);
}

async function writeManualManifest(input: {
  repoRoot: string;
  manifest: M1Manifest;
}): Promise<void> {
  const evidenceRoot = join(input.repoRoot, 'apps/vela-mobile/docs/evidence/hpa-210');
  const directory = createM1RunDirectory({
    evidenceRoot,
    testedBehaviorCommit: input.manifest.testedBehaviorCommit,
    runId: input.manifest.runId,
  });
  await mkdir(dirname(directory), { recursive: true });
  try {
    await mkdir(directory);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new M1UsageError('A manual manifest already exists for that behavior commit and run ID');
    }
    throw error;
  }
  await writeManifest(directory, input.manifest);
}

async function assertManualBehaviorCommitExists(
  args: M1ManualArguments,
  dependencies: HarnessDependencies,
): Promise<void> {
  if (!FULL_COMMIT_PATTERN.test(args.testedBehaviorCommit)) {
    throw new M1UsageError('--tested-behavior-commit must be a full lowercase 40-character SHA');
  }

  try {
    const exists = dependencies.verifyGitCommitExists
      ? await dependencies.verifyGitCommitExists(args.testedBehaviorCommit, dependencies.repoRoot)
      : await verifyGitCommitExistsDirectly(args.testedBehaviorCommit, dependencies.repoRoot);
    if (!exists) {
      throw new M1UsageError('--tested-behavior-commit must name an accessible Git commit');
    }
  } catch (error) {
    if (error instanceof M1UsageError) throw error;
    throw new M1UsageError('--tested-behavior-commit must name an accessible Git commit');
  }
}

async function runManualPhase(
  args: M1ManualArguments,
  dependencies: HarnessDependencies,
): Promise<M1Manifest> {
  await assertManualBehaviorCommitExists(args, dependencies);
  const input = await readManualInput(args.inputPath);
  let manifest: M1Manifest;
  try {
    manifest = createManualM1Manifest({
      testedBehaviorCommit: args.testedBehaviorCommit,
      matrixClass: args.matrixClass,
      runId: input.runId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      config: input.config,
      host: input.host,
      evidence: input.evidence,
      findings: input.findings,
      outcome: input.outcome,
    });
  } catch {
    throw new M1UsageError('Manual input has an invalid manifest shape');
  }

  await writeManualManifest({ repoRoot: dependencies.repoRoot, manifest });
  return manifest;
}

/**
 * Runs one independent machine-verification phase. `all` remains deliberately
 * unavailable until automated, Simulator, and physical evidence can be
 * created atomically without leaving a misleading partial run behind.
 */
export async function runM1FoundationVerification(
  args: ReturnType<typeof parseM1Arguments>,
  dependencies: HarnessDependencies,
): Promise<M1Manifest[]> {
  if (args.mode === 'record-manual') return [await runManualPhase(args, dependencies)];
  if (args.phase === 'automated') return [await runAutomatedPhase(args, dependencies)];
  if (args.phase === 'ios-simulator') return [await runIosSimulatorPhase(args, dependencies)];
  if (args.phase === 'ios-physical-preflight') {
    return [await runIosPhysicalPreflightPhase(args, dependencies)];
  }
  throw new M1HarnessError(
    `${args.phase} verification is not implemented until every required machine phase can run atomically`,
  );
}
