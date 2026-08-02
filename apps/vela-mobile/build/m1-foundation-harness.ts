import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  M1_EXIT_CODE,
  createM1RunDirectory,
  createM1RunId,
  createManualM1Manifest,
  hashFile,
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
const MANUAL_INPUT_DECODER = new TextDecoder('utf-8', { fatal: true });
const MOBILE_CONFIG_KEYS = [
  'VITE_MOBILE_API_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
] as const;

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
        env: { ...process.env, ...spec.env },
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

async function resolveGitHeadDirectly(repoRoot: string): Promise<string> {
  const output = await new Promise<Buffer>((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let settled = false;
    let child;

    try {
      child = spawn('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      reject(new M1HarnessError('Unable to resolve the current Git HEAD'));
      return;
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk.subarray(0, 256 - stdout.length)]);
    });
    child.once('error', () => {
      if (settled) return;
      settled = true;
      reject(new M1HarnessError('Unable to resolve the current Git HEAD'));
    });
    child.once('close', (exitCode) => {
      if (settled) return;
      settled = true;
      if (exitCode !== 0) {
        reject(new M1HarnessError('Unable to resolve the current Git HEAD'));
        return;
      }
      resolve(stdout);
    });
  });

  const commit = output.toString('utf8').trim();
  if (!FULL_COMMIT_PATTERN.test(commit)) {
    throw new M1HarnessError('Git HEAD must resolve to a full lowercase 40-character SHA');
  }
  return commit;
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
      config: {
        source,
        class: classifyMobileConfig(loaded),
        apiOrigin: publicApiOrigin(loaded.VITE_MOBILE_API_URL!),
        region: loaded.VITE_AWS_REGION!,
        oauthDomain: loaded.VITE_COGNITO_OAUTH_DOMAIN!,
        publicIdentifiersConsistent: true,
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

function commandEnvironment(env: ProcessEnvironment): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of MOBILE_CONFIG_KEYS) {
    const value = env[key];
    if (typeof value === 'string') result[key] = value;
  }
  if (env.MOBILE_SKIP_ENV_VALIDATION !== undefined) {
    result.MOBILE_SKIP_ENV_VALIDATION = env.MOBILE_SKIP_ENV_VALIDATION;
  }
  return result;
}

function automatedCommands(dependencies: HarnessDependencies): CommandSpec[] {
  const env = commandEnvironment(dependencies.env);
  const cwd = dependencies.repoRoot;
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

function truncateText(value: string): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= MAX_CAPTURED_OUTPUT_BYTES) return value;

  const suffix = '\n[output truncated at 64 KiB]\n';
  return Buffer.concat([
    bytes.subarray(0, MAX_CAPTURED_OUTPUT_BYTES - Buffer.byteLength(suffix)),
    Buffer.from(suffix),
  ]).toString('utf8');
}

function containsUnsafeEvidenceText(text: string): boolean {
  if (scanMobileSecretText({ path: 'hpa-210-command-output.txt', text }).length > 0) return true;

  return [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
    /(?:[?&](?:code|state|nonce|code_verifier|access_token|id_token|refresh_token)=)/iu,
    /\b(?:access_token|id_token|refresh_token|code_verifier|authorization)\s*[:=]/iu,
    /\bdata:[^\s,]+;base64,/iu,
    /\/oauth\/callback(?:[/?#]|$)/iu,
    /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{8}-[0-9a-f]{16,}|[0-9a-f]{40})\b/iu,
  ].some((pattern) => pattern.test(text));
}

async function persistFailureOutput(input: {
  result: Awaited<ReturnType<CommandRunner>>;
  spec: CommandSpec;
  runDirectory: string;
  repoRoot: string;
  commandIndex: number;
}): Promise<{
  evidence?: M1EvidenceReference;
  withheld: boolean;
}> {
  const stdout = truncateText(typeof input.result.stdout === 'string' ? input.result.stdout : '');
  const stderr = truncateText(typeof input.result.stderr === 'string' ? input.result.stderr : '');
  if (stdout === '' && stderr === '') return { withheld: false };

  const output = `stdout:\n${stdout}\nstderr:\n${stderr}`;
  if (containsUnsafeEvidenceText(output)) return { withheld: true };

  const filename = `command-${(input.commandIndex + 1).toString().padStart(2, '0')}-${input.spec.label}.txt`;
  const outputPath = join(input.runDirectory, filename);
  await writeFile(outputPath, output, { flag: 'wx' });
  const byteSize = Buffer.byteLength(output);

  return {
    withheld: false,
    evidence: {
      kind: 'local-hash',
      location: relativePath(input.repoRoot, outputPath),
      mediaType: 'text/plain; charset=utf-8',
      byteSize,
      sha256: await hashFile(outputPath),
    },
  };
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

async function runAutomatedPhase(
  args: M1VerifyArguments,
  dependencies: HarnessDependencies,
): Promise<M1Manifest> {
  const startedAt = safeDate(dependencies.now);
  const testedBehaviorCommit = await resolveTestedBehaviorCommit(dependencies);
  const context = await createAutomaticRunContext({
    repoRoot: dependencies.repoRoot,
    testedBehaviorCommit,
    startedAt,
  });
  const commands: M1CommandResult[] = [];
  const evidence: M1EvidenceReference[] = [];
  const findings: M1Manifest['findings'] = [];
  let configuration = evaluateMobileConfiguration(dependencies);
  let outcome: M1Outcome = 'passed';

  if (!configuration.isValid) {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'Mobile production configuration is missing or invalid',
    });
  } else if (args.requireDeployedConfig && dependencies.env.MOBILE_SKIP_ENV_VALIDATION === 'true') {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'MOBILE_SKIP_ENV_VALIDATION=true is not allowed for deployed closure runs',
    });
  } else if (args.requireDeployedConfig && configuration.config.class !== 'deployed') {
    outcome = 'prerequisite_missing';
    findings.push({
      severity: 'error',
      summary: 'A deployed mobile configuration is required for closure evidence',
    });
  }

  if (outcome === 'passed') {
    try {
      for (const [commandIndex, spec] of automatedCommands(dependencies).entries()) {
        const commandStartedAt = safeDate(dependencies.now);
        const result = await dependencies.runCommand(spec);
        const commandEndedAt = safeDate(dependencies.now);
        if (!Number.isSafeInteger(result.exitCode)) {
          throw new M1HarnessError(`Command runner returned an invalid exit code for ${spec.label}`);
        }
        commands.push(
          createCommandResult({
            spec,
            repoRoot: dependencies.repoRoot,
            startedAt: commandStartedAt,
            endedAt: commandEndedAt,
            exitCode: result.exitCode,
          }),
        );
        if (result.exitCode === 0) continue;

        const persistedOutput = await persistFailureOutput({
          result,
          spec,
          runDirectory: context.directory,
          repoRoot: dependencies.repoRoot,
          commandIndex,
        });
        if (persistedOutput.evidence) evidence.push(persistedOutput.evidence);
        if (persistedOutput.withheld) {
          findings.push({
            severity: 'warning',
            summary: `Command output for ${spec.label} was withheld because it may contain sensitive data`,
          });
        }
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

async function runManualPhase(
  args: M1ManualArguments,
  dependencies: HarnessDependencies,
): Promise<M1Manifest> {
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
