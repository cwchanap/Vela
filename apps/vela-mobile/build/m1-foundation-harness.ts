import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadMobileBuildEnv } from './validate-mobile-api-url';

const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const EXECUTION_WORKSPACE_PREFIX = 'vela-m1-foundation-';
const MAX_RUN_DIRECTORY_ATTEMPTS = 1_000;

const MOBILE_CONFIG_KEYS = [
  'VITE_MOBILE_API_URL',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_AWS_REGION',
] as const;
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
const DEFAULT_EVIDENCE_DIR_RELATIVE = '.artifacts/hpa-210';

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

export type M1Manifest = {
  schemaVersion: 2;
  runId: string;
  testedCommit: string;
  phase: 'automated';
  startedAt: string;
  endedAt: string;
  outcome: 'passed' | 'failed';
  exitCode: 0 | 1;
  commands: Array<{
    label: string;
    status: 'passed' | 'failed';
    exitCode: number;
    elapsedMs: number;
  }>;
};

export type M1Arguments = { evidenceDir?: string };

export class M1UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'M1UsageError';
  }
}

class M1HarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'M1HarnessError';
  }
}

export type ExecutionWorkspace = {
  root: string;
  dispose: () => Promise<void>;
};

export type HarnessDependencies = {
  repoRoot: string;
  now: () => Date;
  platform: typeof process.platform;
  env: Record<string, string | undefined>;
  runCommand: CommandRunner;
  /**
   * Test-only injection point. Production callers omit this and resolve the
   * exact current Git HEAD directly, outside the eight automated gate calls.
   */
  resolveTestedBehaviorCommit?: () => Promise<string>;
  /**
   * Test-only injection point. Production callers create a clean detached
   * worktree at the tested behavior commit instead of running in the dirty
   * live checkout.
   */
  createExecutionWorkspace?: (input: {
    repoRoot: string;
    testedBehaviorCommit: string;
  }) => Promise<ExecutionWorkspace>;
  /**
   * Test-only injection point. Overrides the process environment used to build
   * the restricted gate environment (defaults to `env`).
   */
  executionProcessEnvironment?: Record<string, string | undefined>;
};

/**
 * Parses only the public harness syntax. Invalid user input is deliberately
 * separated from a failed verification gate so the CLI can preserve the
 * stable exit-code contract without writing a misleading pass manifest.
 */
export function parseM1Arguments(argv: string[]): M1Arguments {
  const args: M1Arguments = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--evidence-dir') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value === '') {
        throw new M1UsageError('--evidence-dir requires a path');
      }
      args.evidenceDir = value;
      i += 1;
      continue;
    }
    throw new M1UsageError(`Unknown argument: ${flag}`);
  }
  return args;
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

/**
 * Builds the restricted gate environment: a whitelist of safe process
 * variables plus the five public mobile configuration keys. The mobile
 * config keys are load-bearing for the secret-scan gate's integrity: a gate
 * run without them could silently scan the wrong configuration.
 */
function commandEnvironment(
  loaded: ReturnType<typeof loadMobileBuildEnv>,
  procEnv: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SAFE_EXECUTION_ENVIRONMENT_KEYS) {
    const value = procEnv[key];
    if (typeof value === 'string') result[key] = value;
  }
  for (const key of MOBILE_CONFIG_KEYS) {
    const value = loaded[key];
    if (typeof value !== 'string') {
      throw new M1HarnessError('Mobile build configuration incomplete');
    }
    result[key] = value;
  }
  return result;
}

function automatedCommands(
  executionRoot: string,
  loaded: ReturnType<typeof loadMobileBuildEnv>,
  procEnv: Record<string, string | undefined>,
): CommandSpec[] {
  const env = commandEnvironment(loaded, procEnv);
  const cwd = executionRoot;
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

function createRunId(now: Date): string {
  return (
    now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/u, 'Z') + '-automated'
  );
}

/**
 * Creates a clean detached worktree at the tested behavior commit. This is
 * the clean-checkout guarantee: gates never run against the dirty live
 * checkout, so local changes cannot leak into verification evidence.
 */
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

/**
 * Writes the manifest under `<evidenceDir>/<commit>/<runId>/manifest.json`
 * and returns the runId actually used. Exclusive directory create means a
 * same-second rerun gets a -2, -3, ... suffix so the path is always unique
 * and a rerun never overwrites a prior receipt.
 */
async function writeManifest(
  evidenceDir: string,
  testedCommit: string,
  baseRunId: string,
  manifest: M1Manifest,
): Promise<string> {
  const commitDir = join(evidenceDir, testedCommit);
  await mkdir(commitDir, { recursive: true });

  for (let attempt = 0; attempt < MAX_RUN_DIRECTORY_ATTEMPTS; attempt += 1) {
    const runId = attempt === 0 ? baseRunId : `${baseRunId}-${attempt + 1}`;
    const dir = join(commitDir, runId);
    try {
      await mkdir(dir, { recursive: false });
      // Mutate the manifest's runId to the chosen directory name BEFORE
      // serializing so a same-second rerun's receipt always matches its
      // directory (a -2, -3, ... suffix must never be left out of the file).
      manifest.runId = runId;
      await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return runId;
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error;
    }
  }
  throw new M1HarnessError('Unable to create a unique run directory');
}

export async function runM1FoundationVerification(
  args: M1Arguments,
  deps: HarnessDependencies,
): Promise<M1Manifest[]> {
  const startedAt = deps.now();
  const testedCommit = deps.resolveTestedBehaviorCommit
    ? await deps.resolveTestedBehaviorCommit()
    : await resolveGitHeadDirectly(deps.repoRoot);
  if (!FULL_COMMIT_PATTERN.test(testedCommit)) {
    throw new M1HarnessError('HEAD must be a full 40-char SHA');
  }

  const loaded = loadMobileBuildEnv(
    'production',
    join(deps.repoRoot, 'apps/vela-mobile'),
    deps.env,
  );
  const runId = createRunId(startedAt);

  const commands: M1Manifest['commands'] = [];
  let outcome: M1Manifest['outcome'] = 'passed';

  const workspace = deps.createExecutionWorkspace
    ? await deps.createExecutionWorkspace({
        repoRoot: deps.repoRoot,
        testedBehaviorCommit: testedCommit,
      })
    : await createDetachedExecutionWorkspace({
        repoRoot: deps.repoRoot,
        testedBehaviorCommit: testedCommit,
      });

  try {
    const specs = automatedCommands(
      workspace.root,
      loaded,
      deps.executionProcessEnvironment ?? deps.env,
    );
    for (const spec of specs) {
      const cmdStart = deps.now();
      const result = await deps.runCommand(spec);
      const cmdEnd = deps.now();
      const exitCode = Number.isSafeInteger(result.exitCode) ? result.exitCode : 1;
      commands.push({
        label: spec.label,
        status: exitCode === 0 ? 'passed' : 'failed',
        exitCode,
        elapsedMs: cmdEnd.getTime() - cmdStart.getTime(),
      });
      if (exitCode !== 0) {
        outcome = 'failed';
        break;
      }
    }
  } finally {
    await workspace.dispose().catch(() => undefined);
  }

  const manifest: M1Manifest = {
    schemaVersion: 2,
    runId,
    testedCommit,
    phase: 'automated',
    startedAt: startedAt.toISOString(),
    endedAt: deps.now().toISOString(),
    outcome,
    exitCode: outcome === 'passed' ? 0 : 1,
    commands,
  };
  const evidenceDir = resolve(deps.repoRoot, args.evidenceDir ?? DEFAULT_EVIDENCE_DIR_RELATIVE);
  await writeManifest(evidenceDir, testedCommit, runId, manifest);
  return [manifest];
}
