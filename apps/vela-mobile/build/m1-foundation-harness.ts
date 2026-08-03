import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  M1_EXIT_CODE,
  createM1RunDirectory,
  createM1RunId,
  createManualM1Manifest,
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

async function createAutomaticRunContext(input: {
  repoRoot: string;
  testedBehaviorCommit: string;
  startedAt: Date;
}): Promise<AutomaticRunContext> {
  const evidenceRoot = join(input.repoRoot, 'apps/vela-mobile/docs/evidence/hpa-210');
  const baseRunId = createM1RunId(input.startedAt, 'automated');
  await mkdir(join(evidenceRoot, input.testedBehaviorCommit), { recursive: true });

  for (let attempt = 0; attempt < MAX_RUN_DIRECTORY_ATTEMPTS; attempt += 1) {
    const runId = attempt === 0 ? baseRunId : `${baseRunId}-${attempt + 1}`;
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

function createAutomatedManifest(input: {
  context: AutomaticRunContext;
  testedBehaviorCommit: string;
  startedAt: Date;
  endedAt: Date;
  outcome: M1Outcome;
  config: M1Manifest['config'];
  platform: RuntimePlatform;
  commands: M1CommandResult[];
  evidence: M1EvidenceReference[];
  findings: M1Manifest['findings'];
}): M1Manifest {
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

async function runAutomatedPhase(
  args: M1VerifyArguments,
  dependencies: HarnessDependencies,
): Promise<M1Manifest> {
  const startedAt = safeDate(dependencies.now);
  const testedBehaviorCommit = await resolveTestedBehaviorCommit(dependencies);
  const commands: M1CommandResult[] = [];
  const evidence: M1EvidenceReference[] = [];
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
      summary: 'Git working tree state could not be verified before automated evidence',
    });
  }

  if (!configuration.isValid) {
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

  // A prerequisite manifest is diagnostic only: it has no gate output or
  // evidence references and cannot be treated as passing verification.
  const context = await createAutomaticRunContext({
    repoRoot: dependencies.repoRoot,
    testedBehaviorCommit,
    startedAt,
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
          outcome = 'harness_error';
          findings.push({
            severity: 'error',
            summary: 'The clean execution workspace could not be removed safely',
          });
        }
      }
    }
  }

  const manifest = createAutomatedManifest({
    context,
    testedBehaviorCommit,
    startedAt,
    endedAt: safeDate(dependencies.now),
    outcome,
    config: configuration.config,
    platform: dependencies.platform,
    commands,
    evidence,
    findings,
  });
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

  try {
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
  } catch {
    throw new M1UsageError('Manual input has an invalid manifest shape');
  }
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
 * Runs the currently implemented verification phase. Simulator and physical
 * preflight remain explicit extension points for Tasks 6–7: they are accepted
 * syntax but never silently produce partial automation evidence in Task 5.
 */
export async function runM1FoundationVerification(
  args: ReturnType<typeof parseM1Arguments>,
  dependencies: HarnessDependencies,
): Promise<M1Manifest[]> {
  if (args.mode === 'record-manual') return [await runManualPhase(args, dependencies)];
  if (args.phase !== 'automated') {
    throw new M1HarnessError(`${args.phase} verification is not implemented in the automated phase`);
  }
  return [await runAutomatedPhase(args, dependencies)];
}
