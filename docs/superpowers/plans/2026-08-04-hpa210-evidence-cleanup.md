# HPA-210 Evidence Cleanup & M1 Verification Simplification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop committing generated M1 verification evidence, collapse the over-built manifest subsystem to a minimal local-artifact runner, and extract a standalone deployed-config verifier — while preserving the clean-state guarantee and the future-GO config criterion.

**Architecture:** Replace the 4-phase, 12-field manifest subsystem with a single-phase `automated` runner that resolves HEAD, executes the 8 gates inside a detached worktree at that commit, and writes a minimal local manifest under `.artifacts/hpa-210/`. Move deployed-config consistency into a small standalone verifier. Untrack all generated evidence and rewrite the docs/links.

**Tech Stack:** TypeScript (build-time, run via `bun`), Vitest, ESLint flat config, Quasar/Vue (unchanged), existing `validate-mobile-api-url.ts` env loader.

**Spec:** `docs/superpowers/specs/2026-08-04-hpa210-evidence-cleanup-design.md`

## Global Constraints

- Work only in worktree `/Users/chanwaichan/workspace/Vela/.worktrees/hpa-210-ios-foundation-verification` on branch `hpa-210-ios-foundation-verification`.
- **Do not commit** unless a task step explicitly says to. The user commits / squash-merges per their own judgment. Each task's final "commit" step is written as a staged-command the user can approve.
- Run gates/tests from `apps/vela-mobile` unless noted: `bun run lint`, `bun run typecheck`, `bun run test`, `bun run verify:m1-foundation`.
- Preserve these exact existing exports consumed by `scripts/verify-m1-foundation.mjs`: `M1UsageError`, `parseM1Arguments`, `runM1FoundationVerification`, `spawnCommand`. The CLI expects `runM1FoundationVerification` to return an array (`manifests.at(-1)?.exitCode`).
- The 8 automated gate labels, in order, are: `install`, `lint`, `typecheck`, `compile`, `build`, `test`, `production-diagnostics`, `mobile-secret-scan`. `outcome: "passed"` requires all 8, in order, each `exitCode: 0`.
- New manifest `schemaVersion: 2` (incompatible with legacy v1).
- `.gitignore` changes are **supplement, not replace**: keep the existing `apps/vela-mobile/docs/evidence/local-raw/` rule.

---

## File Structure

| File                                                                             | Responsibility                                                                          | Action                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| `apps/vela-mobile/build/verify-deployed-config.ts`                               | Standalone deployed-config consistency verifier (future-GO criterion)                   | Create                        |
| `apps/vela-mobile/build/verify-deployed-config.test.ts`                          | Verifier unit tests                                                                     | Create                        |
| `apps/vela-mobile/build/m1-foundation-harness.ts`                                | Minimal single-phase runner + detached-worktree exec + restricted env + manifest writer | Rewrite (~3,900 → ~550 lines) |
| `apps/vela-mobile/build/m1-foundation-contract.ts`                               | (Legacy schema/validation)                                                              | Delete                        |
| `apps/vela-mobile/build/m1-foundation-harness.test.ts`                           | Slim suite: arg parse, gating, manifest emission, CLI runtime                           | Replace                       |
| `apps/vela-mobile/build/m1-foundation-contract.test.ts`                          | (Legacy contract tests)                                                                 | Delete                        |
| `apps/vela-mobile/build/mobile-secret-policy.test.ts`                            | Update harness-filename examples                                                        | Modify                        |
| `apps/vela-mobile/package.json`                                                  | Add `verify:deployed-config` script                                                     | Modify                        |
| `.gitignore`                                                                     | Add `hpa-210/` + `/.artifacts/`                                                         | Modify                        |
| `apps/vela-mobile/docs/evidence/hpa-210/**`                                      | Untrack (local only after)                                                              | `git rm -r --cached`          |
| `apps/vela-mobile/docs/m1-ios-foundation-verification.md`                        | Delink, inline facts, replace preflight-rerun, update testedCommit                      | Modify                        |
| `apps/vela-mobile/docs/ios-foundation-architecture.md`                           | Remove evidence links + cross-phase claims                                              | Modify                        |
| `apps/vela-mobile/docs/ios-interaction-baseline.md`                              | Update manifest/preflight narrative                                                     | Modify                        |
| `apps/vela-mobile/README.md`                                                     | Rewrite verification section for new CLI surface                                        | Modify                        |
| `apps/vela-mobile/scripts/verify-production-diagnostics.mjs`                     | Repoint `--require-deployed-config` comment                                             | Modify                        |
| `CLAUDE.md`                                                                      | Update preflight/Simulator wording                                                      | Modify                        |
| `docs/superpowers/specs/2026-08-02-mobile-ios-foundation-verification-design.md` | Add supersession notice                                                                 | Modify                        |

---

## Task 1: Standalone deployed-config verifier

**Files:**

- Create: `apps/vela-mobile/build/verify-deployed-config.ts`
- Create: `apps/vela-mobile/build/verify-deployed-config.test.ts`
- Modify: `apps/vela-mobile/package.json:18` (add script after `verify:m1-foundation`)

**Interfaces:**

- Consumes: `loadMobileBuildEnv` from `./validate-mobile-api-url` (existing; signature `loadMobileBuildEnv(mode, mobileRoot, env)`). The 5 public keys: `VITE_MOBILE_API_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID`, `VITE_COGNITO_OAUTH_DOMAIN`, `VITE_AWS_REGION`.
- Produces: `verifyDeployedConfig({ mobileRoot, cdkOutputsPath })` → throws on mismatch, returns `{ mobileApiUrl, cognitoUserPoolId, cognitoMobileUserPoolClientId, cognitoOAuthDomain, cognitoRegion }` on success. CLI entry exits `0`/`1`/`2`.

**Background:** The current harness has this comparison inline (`DEPLOYED_IDENTITY_OUTPUT_KEYS` at `m1-foundation-harness.ts:45`, CDK outputs keyed `MobileApiURL`, `CognitoUserPoolId`, `CognitoMobileUserPoolClientId`, `CognitoOAuthDomain`, `CognitoRegion`). This task extracts it as a standalone module so the manifest subsystem can be deleted without losing the future-GO criterion.

- [ ] **Step 1: Write the failing test**

Create `apps/vela-mobile/build/verify-deployed-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDeployedConfig } from './verify-deployed-config';

describe('verifyDeployedConfig', () => {
  it('passes when .env.production identifiers match cdk-outputs.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vela-cfg-'));
    try {
      await writeFile(
        join(dir, '.env.production'),
        [
          'VITE_MOBILE_API_URL=https://vela.example/api/',
          'VITE_COGNITO_USER_POOL_ID=us-east-1_POOL',
          'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=abc123',
          'VITE_COGNITO_OAUTH_DOMAIN=auth.example',
          'VITE_AWS_REGION=us-east-1',
        ].join('\n'),
      );
      // cdk-outputs.json holds the CloudFormation-exports array that
      // `cdk deploy` writes (entries of `{ OutputKey, OutputValue, ... }`),
      // not a flat object. verify-deployed-config.ts reduces this array to a
      // key → value map before comparison (see its `loadOutputs`).
      await writeFile(
        join(dir, 'cdk-outputs.json'),
        JSON.stringify([
          { OutputKey: 'MobileApiURL', OutputValue: 'https://vela.example/api/' },
          { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_POOL' },
          { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'abc123' },
          { OutputKey: 'CognitoOAuthDomain', OutputValue: 'auth.example' },
          { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
        ]),
      );
      const result = await verifyDeployedConfig({
        mobileRoot: dir,
        cdkOutputsPath: join(dir, 'cdk-outputs.json'),
      });
      expect(result.cognitoUserPoolId).toBe('us-east-1_POOL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws on a user-pool-id mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vela-cfg-'));
    try {
      await writeFile(
        join(dir, '.env.production'),
        'VITE_COGNITO_USER_POOL_ID=us-east-1_POOL\nVITE_MOBILE_API_URL=https://vela.example/api/\nVITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=abc\nVITE_COGNITO_OAUTH_DOMAIN=auth.example\nVITE_AWS_REGION=us-east-1\n',
      );
      await writeFile(
        join(dir, 'cdk-outputs.json'),
        JSON.stringify([
          { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_DIFFERENT' },
          { OutputKey: 'MobileApiURL', OutputValue: 'https://vela.example/api/' },
          { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'abc' },
          { OutputKey: 'CognitoOAuthDomain', OutputValue: 'auth.example' },
          { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
        ]),
      );
      await expect(
        verifyDeployedConfig({ mobileRoot: dir, cdkOutputsPath: join(dir, 'cdk-outputs.json') }),
      ).rejects.toThrow(/CognitoUserPoolId/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when cdk-outputs.json is missing but requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vela-cfg-'));
    try {
      await writeFile(join(dir, '.env.production'), 'VITE_AWS_REGION=us-east-1\n');
      await expect(
        verifyDeployedConfig({ mobileRoot: dir, cdkOutputsPath: join(dir, 'missing.json') }),
      ).rejects.toThrow(/cdk-outputs/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run build/verify-deployed-config.test.ts` (from `apps/vela-mobile`)
Expected: FAIL — `Cannot find module './verify-deployed-config'`.

- [ ] **Step 3: Implement the verifier**

Create `apps/vela-mobile/build/verify-deployed-config.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadMobileBuildEnv } from './validate-mobile-api-url';

const CDK_OUTPUT_KEYS = {
  mobileApiUrl: 'MobileApiURL',
  cognitoUserPoolId: 'CognitoUserPoolId',
  cognitoMobileUserPoolClientId: 'CognitoMobileUserPoolClientId',
  cognitoOAuthDomain: 'CognitoOAuthDomain',
  cognitoRegion: 'CognitoRegion',
} as const;

export type DeployedConfig = {
  mobileApiUrl: string;
  cognitoUserPoolId: string;
  cognitoMobileUserPoolClientId: string;
  cognitoOAuthDomain: string;
  cognitoRegion: string;
};

export type VerifyOptions = {
  mobileRoot: string;
  /** Absolute path to cdk-outputs.json. When omitted, only env presence is validated. */
  cdkOutputsPath?: string;
  env?: Record<string, string | undefined>;
};

/**
 * Validates that the mobile build env's public Cognito identifiers match the
 * deployed CDK outputs. This is the HPA-210 closure criterion previously
 * carried by the manifest subsystem's --require-deployed-config check.
 */
export async function verifyDeployedConfig(options: VerifyOptions): Promise<DeployedConfig> {
  const loaded = loadMobileBuildEnv('production', options.mobileRoot, options.env ?? {});
  const actual: DeployedConfig = {
    mobileApiUrl: loaded.VITE_MOBILE_API_URL!,
    cognitoUserPoolId: loaded.VITE_COGNITO_USER_POOL_ID!,
    cognitoMobileUserPoolClientId: loaded.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID!,
    cognitoOAuthDomain: loaded.VITE_COGNITO_OAUTH_DOMAIN!,
    cognitoRegion: loaded.VITE_AWS_REGION!,
  };
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing mobile build identifier: ${key}`);
    }
  }
  if (!options.cdkOutputsPath) return actual;

  let raw: string;
  try {
    raw = await readFile(options.cdkOutputsPath, 'utf8');
  } catch {
    throw new Error(`Unable to read cdk-outputs.json at ${options.cdkOutputsPath}`);
  }
  const outputs = JSON.parse(raw) as Record<string, unknown>;
  for (const [field, cdkKey] of Object.entries(CDK_OUTPUT_KEYS)) {
    const expected = outputs[cdkKey];
    if (typeof expected !== 'string' || expected !== (actual as Record<string, unknown>)[field]) {
      throw new Error(
        `Deployed config mismatch for ${cdkKey}: env does not match cdk-outputs.json`,
      );
    }
  }
  return actual;
}

async function runCli(argv: string[]): Promise<number> {
  const mobileRoot = join(process.cwd(), 'apps/vela-mobile');
  const cdkIdx = argv.indexOf('--cdk-outputs');
  const cdkOutputsPath = cdkIdx !== -1 ? argv[cdkIdx + 1] : undefined;
  if (cdkIdx !== -1 && !cdkOutputsPath) {
    console.error('--cdk-outputs requires a path');
    return 2;
  }
  try {
    const result = await verifyDeployedConfig({ mobileRoot, cdkOutputsPath });
    console.info(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'deployed-config verification failed');
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run build/verify-deployed-config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the package script**

In `apps/vela-mobile/package.json`, add after the `verify:m1-foundation` line (line 18):

```json
    "verify:deployed-config": "bun run build/verify-deployed-config.ts",
```

- [ ] **Step 6: Lint + typecheck**

Run: `bun run lint && bun run typecheck` (from `apps/vela-mobile`)
Expected: PASS, no new errors.

- [ ] **Step 7: Commit (stage only; user approves)**

```bash
git add apps/vela-mobile/build/verify-deployed-config.ts apps/vela-mobile/build/verify-deployed-config.test.ts apps/vela-mobile/package.json
git commit -m "feat(mobile): add standalone deployed-config verifier for HPA-210 closure gate"
```

---

## Task 2: Minimal harness rewrite + delete contract + slim tests

**Files:**

- Rewrite: `apps/vela-mobile/build/m1-foundation-harness.ts`
- Delete: `apps/vela-mobile/build/m1-foundation-contract.ts`
- Replace: `apps/vela-mobile/build/m1-foundation-harness.test.ts`
- Delete: `apps/vela-mobile/build/m1-foundation-contract.test.ts`
- Modify: `apps/vela-mobile/build/mobile-secret-policy.test.ts` (harness-filename examples)

**Interfaces:**

- Consumes: `loadMobileBuildEnv` from `./validate-mobile-api-url`; `scanMobileSecretText` no longer needed in harness (secret scan is a gate command, not inline).
- Produces (preserved exports): `M1UsageError`, `parseM1Arguments`, `runM1FoundationVerification`, `spawnCommand`. New: `M1Manifest` (minimal type, `schemaVersion: 2`). `runM1FoundationVerification` returns `Promise<M1Manifest[]>`.

**Background — what carries over verbatim from the existing harness:**

- `MOBILE_CONFIG_KEYS` (5 keys), `SAFE_EXECUTION_ENVIRONMENT_KEYS` (env allowlist), `CommandSpec`, `CommandRunner` types.
- `spawnCommand` (the no-shell runner with bounded output capture).
- `commandEnvironment(loaded, processEnv)` — restricted env builder.
- `automatedCommands(...)` — the 8-command builder (drop the `production-diagnostics`/`mobile-secret-scan` extra wiring; keep the simple 8 specs).
- `createDetachedExecutionWorkspace(...)` + `resolveGitHeadDirectly` + `runGitDirectly` — the clean-checkout guarantee (arch-review P1-1).
- [ ] **Step 1: Write the failing slim test suite**

Create `apps/vela-mobile/build/m1-foundation-harness.test.ts` (full replacement):

```ts
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

function fakeDeps(overrides: Partial<HarnessDependencies> = {}): HarnessDependencies {
  return {
    repoRoot: '/repo',
    now: () => new Date('2026-08-04T06:30:52.000Z'),
    platform: 'darwin',
    env: {},
    runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    resolveTestedBehaviorCommit: async () => 'a'.repeat(40),
    resolveDirtyPaths: async () => [],
    createExecutionWorkspace: async () => ({ root: '/ws', dispose: async () => undefined }),
    ...overrides,
  } as HarnessDependencies;
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
      const [manifest] = await runM1FoundationVerification(
        parseM1Arguments(['--evidence-dir', evidenceDir]),
        deps,
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
      const [manifest] = await runM1FoundationVerification(
        parseM1Arguments(['--evidence-dir', evidenceDir]),
        deps,
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
      const [manifest] = await runM1FoundationVerification(
        parseM1Arguments(['--evidence-dir', evidenceDir]),
        fakeDeps(),
      );
      const file = join(evidenceDir, 'a'.repeat(40), manifest.runId, 'manifest.json');
      const written = JSON.parse(await readFile(file, 'utf8')) as { outcome: string };
      expect(written.outcome).toBe('passed');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run build/m1-foundation-harness.test.ts`
Expected: FAIL — old module still exports the legacy `parseM1Arguments` shape (rejects `[]`, expects `--phase`).

- [ ] **Step 3: Delete the legacy contract + its tests**

```bash
git rm apps/vela-mobile/build/m1-foundation-contract.ts apps/vela-mobile/build/m1-foundation-contract.test.ts
```

- [ ] **Step 4: Rewrite the harness**

Overwrite `apps/vela-mobile/build/m1-foundation-harness.ts` with the minimal implementation. Structure (implementer fills exact bodies, carrying over the verbatim helpers named in Background):

```ts
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { loadMobileBuildEnv } from './validate-mobile-api-url';

const FULL_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
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
const GATE_LABELS = [
  'install',
  'lint',
  'typecheck',
  'compile',
  'build',
  'test',
  'production-diagnostics',
  'mobile-secret-scan',
] as const;
const DEFAULT_EVIDENCE_DIR_RELATIVE = '.artifacts/hpa-210';

// --- types ---
export type CommandSpec = {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
};
export type CommandRunner = (
  spec: CommandSpec,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

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
  constructor(m: string) {
    super(m);
    this.name = 'M1UsageError';
  }
}
class M1HarnessError extends Error {
  constructor(m: string) {
    super(m);
    this.name = 'M1HarnessError';
  }
}

export type ExecutionWorkspace = { root: string; dispose: () => Promise<void> };
export type HarnessDependencies = {
  repoRoot: string;
  now: () => Date;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  runCommand: CommandRunner;
  resolveTestedBehaviorCommit?: () => Promise<string>;
  createExecutionWorkspace?: (input: {
    repoRoot: string;
    testedBehaviorCommit: string;
  }) => Promise<ExecutionWorkspace>;
  executionProcessEnvironment?: Record<string, string | undefined>;
};

// --- arg parsing ---
export function parseM1Arguments(argv: string[]): M1Arguments {
  const args: M1Arguments = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--evidence-dir') {
      const value = argv[i + 1];
      if (typeof value !== 'string' || value === '')
        throw new M1UsageError('--evidence-dir requires a path');
      args.evidenceDir = value;
      i += 1;
      continue;
    }
    throw new M1UsageError(`Unknown argument: ${flag}`);
  }
  return args;
}

// --- spawnCommand (carry over verbatim bounded-output no-shell runner) ---
export const spawnCommand: CommandRunner = async (spec) => {
  // (carry over the existing spawn() implementation from the deleted file:
  //  spawn without shell, capture stdout/stderr capped at 64 KiB each)
  // <implementer: paste the existing spawnCommand body>
};

// --- restricted env + command builder (carry over) ---
function commandEnvironment(
  loaded: ReturnType<typeof loadMobileBuildEnv>,
  procEnv: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SAFE_EXECUTION_ENVIRONMENT_KEYS) {
    const v = procEnv[key];
    if (typeof v === 'string') result[key] = v;
  }
  for (const key of MOBILE_CONFIG_KEYS) {
    const v = loaded[key];
    if (typeof v !== 'string') throw new M1HarnessError('Mobile build configuration incomplete');
    result[key] = v;
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

// --- git helpers (carry over runGitDirectly/resolveGitHeadDirectly verbatim) ---
// <implementer: paste runGitDirectly, resolveGitHeadDirectly, parseGitStatusPaths from the deleted file>
// (these are the no-shell git invocations used to resolve HEAD and manage worktrees)

function createRunId(now: Date): string {
  return (
    now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/u, 'Z') + '-automated'
  );
}

// --- detached worktree (carry over createDetachedExecutionWorkspace verbatim) ---
// <implementer: paste the existing createDetachedExecutionWorkspace body>

// --- manifest writer with same-second collision handling ---
async function writeManifest(
  evidenceDir: string,
  commit: string,
  runId: string,
  manifest: M1Manifest,
): Promise<void> {
  const base = join(evidenceDir, commit);
  await mkdir(base, { recursive: true });
  let attempt = 0;
  let dir = join(base, runId);
  while (attempt < MAX_RUN_DIRECTORY_ATTEMPTS) {
    try {
      await mkdir(dir, { recursive: false });
      break;
    } catch {
      /* exists */
    }
    attempt += 1;
    dir = join(base, `${runId}-${attempt + 1}`);
  }
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(dir, { recursive: true });
  await readFile(join(dir, 'manifest.json'), 'utf8').then(
    () => undefined,
    async () => {
      /* only write if absent */
    },
  );
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

// --- orchestrator ---
export async function runM1FoundationVerification(
  args: M1Arguments,
  deps: HarnessDependencies,
): Promise<M1Manifest[]> {
  const startedAt = deps.now();
  const testedCommit = deps.resolveTestedBehaviorCommit
    ? await deps.resolveTestedBehaviorCommit()
    : await resolveGitHeadDirectly(deps.repoRoot);
  if (!FULL_COMMIT_PATTERN.test(testedCommit))
    throw new M1HarnessError('HEAD must be a full 40-char SHA');

  const mobileRoot = join(deps.repoRoot, 'apps/vela-mobile');
  const loaded = loadMobileBuildEnv('production', mobileRoot, deps.env);
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
```

Note for implementer: the `<implementer: paste ...>` markers reference verbatim bodies in the file being overwritten — copy them from the current `m1-foundation-harness.ts` before overwriting. Do NOT leave any marker in the final file. The `writeManifest` collision logic above is intentionally explicit; simplify if the two-pass `readFile` check reads awkwardly, but keep exclusive-create semantics so same-second collisions don't overwrite.

- [ ] **Step 5: Run the slim test suite**

Run: `bun vitest run build/m1-foundation-harness.test.ts`
Expected: PASS (all tests). If `spawnCommand` test fails, ensure the carried-over body is intact.

- [ ] **Step 6: Update secret-policy test examples**

In `apps/vela-mobile/build/mobile-secret-policy.test.ts`, the harness-filename examples at lines ~394–438 reference the old large harness test file. Update any example paths/labels to match the new slim `m1-foundation-harness.test.ts`. Run `bun vitest run build/mobile-secret-policy.test.ts` to confirm.

- [ ] **Step 7: Lint + typecheck + full test**

Run: `bun run lint && bun run typecheck && bun run test` (from `apps/vela-mobile`)
Expected: PASS. The CLI `scripts/verify-m1-foundation.mjs` must still typecheck (it imports the 4 preserved exports).

- [ ] **Step 8: Commit (stage only; user approves)**

```bash
git add apps/vela-mobile/build/m1-foundation-harness.ts apps/vela-mobile/build/m1-foundation-harness.test.ts apps/vela-mobile/build/mobile-secret-policy.test.ts
git commit -m "refactor(mobile): collapse M1 verification to minimal local-artifact runner"
```

---

## Task 3: Repo cleanup — untrack evidence, update .gitignore

**Files:**

- Modify: `.gitignore:65-69`
- Untrack: `apps/vela-mobile/docs/evidence/hpa-210/**` (local files stay)

- [ ] **Step 1: Untrack the evidence directory (keep working-tree files)**

```bash
git rm -r --cached apps/vela-mobile/docs/evidence/hpa-210/
```

- [ ] **Step 2: Supplement .gitignore**

In `.gitignore`, find lines 65–69 (the `local-raw` block) and replace with:

```gitignore
# Mobile verification evidence is local and ephemeral.
# Generated manifests/receipts live under .artifacts/ (see below) or the
# docs/evidence/hpa-210/ tree, both gitignored; only the durable Markdown
# decision record (m1-ios-foundation-verification.md) is committed.
apps/vela-mobile/docs/evidence/local-raw/
apps/vela-mobile/docs/evidence/hpa-210/
/.artifacts/
```

- [ ] **Step 3: Verify ignores take effect**

Run:

```bash
git check-ignore apps/vela-mobile/docs/evidence/hpa-210/24ad58104f54d375b9e619aec5be719811106c71/20260804T063052Z-automated/manifest.json
git check-ignore .artifacts/hpa-210/x
git status --short | grep -c "evidence/hpa-210" || echo "0 tracked evidence files"
```

Expected: first two print the paths (ignored); the count is `0`.

- [ ] **Step 4: Commit (stage only; user approves)**

```bash
git add .gitignore
git commit -m "chore(mobile): untrack HPA-210 evidence; ignore .artifacts/ and evidence/hpa-210/"
```

---

## Task 4: Documentation sweep

**Files:**

- Modify: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify: `apps/vela-mobile/docs/ios-foundation-architecture.md` (lines ~8, 12–14, 20, 29, 151)
- Modify: `apps/vela-mobile/docs/ios-interaction-baseline.md` (lines ~142, 149–150)
- Modify: `apps/vela-mobile/README.md` (lines ~152–205)
- Modify: `apps/vela-mobile/scripts/verify-production-diagnostics.mjs` (line ~11)
- Modify: `CLAUDE.md` (lines ~198–203, 220–222)
- Modify: `docs/superpowers/specs/2026-08-02-mobile-ios-foundation-verification-design.md` (add supersession notice at top)

**Interfaces:** None (docs only). Accuracy target: no remaining `evidence/hpa-210/.../manifest.json` links, no instructions to run deleted flags (`--phase ios-physical-preflight`, `--require-deployed-config`, `--record-manual`).

- [ ] **Step 1: Rewrite the M1 decision record**

In `apps/vela-mobile/docs/m1-ios-foundation-verification.md`:

- **Selected Run Manifests** (lines ~67–90): delete the link table. Replace with a text paragraph: the automated phase passed on the cleanup-head commit `<SHA>` (filled in Task 5, Step 2), the eight gates ran in order, and the receipt is a local artifact under `.artifacts/hpa-210/` (not committed). Remove the `24ad581`/`de276f3` "selected/historical" selection narrative.
- **Physical iPhone Matrix** (lines ~107–116): drop the `manifest.json` link in the Evidence column for the historical preflight row; replace with `Local receipt (untracked)`. Change the `Rerun for 24ad581` follow-up to `Rerun via the manual physical-run checklist` (Task 4 Step 4).
- **Minimum corrective issues** (lines ~28–47): remove the bullet instructing to rerun the deleted physical preflight. Replace with a bullet pointing at the manual physical-run checklist (new section, Step 4 below).
- **Cross-phase linkage paragraphs** (lines ~11–18, ~54–66, ~84–89): delete.
- Add a new section **`## Manual Physical-Run Checklist`** after the Physical iPhone Matrix, with these items (each a bullet, owner = "operator"):
  - Device trust + Developer Mode enabled.
  - Signing: team/identity correlation, profile expiry, `get-task-allow`, certificate availability (confirm via Xcode).
  - Bundle id matches the mobile client config in `.env.production`.
  - Device eligibility: safe availability, generic non-identifying alias — **no UDID/email persistence**.
  - Deployed-config consistency: `bun run verify:deployed-config -- --cdk-outputs packages/cdk/cdk-outputs.json`.
- Leave the empty Production Smoke / Diagnostic Observation matrices and the "audio adapter decision pending" finding unchanged.

- [ ] **Step 2: Delink `ios-foundation-architecture.md`**

- Lines ~8, 20, 29: remove the three `[...](evidence/hpa-210/.../manifest.json)` markdown links; keep the surrounding prose but reword to "the automated phase passed" / "the Simulator run is historical" / "the physical preflight is historical" without linking to files.
- Lines ~12–14, ~151: delete the sentences asserting "immutable cross-phase linkage", "run-identity and phase verification in the cross-phase loader", and the `f0c6fe9` preflight-is-historical manifest reference (reword to plain prose).

- [ ] **Step 3: Update `ios-interaction-baseline.md`**

- Lines ~142, ~149–150: reword the "selected automated manifest" / "physical preflight is `prerequisite_missing`" narrative to past-tense prose without manifest file references. State physical testing is deferred.

- [ ] **Step 4: Rewrite the verification section of `README.md`**

Replace lines ~152–205 with a concise section reflecting the new surface:

- Command: `bun run verify:m1-foundation [-- --evidence-dir <path>]` — runs the 8 automated gates, writes a local manifest to `.artifacts/hpa-210/` (default) or `<evidence-dir>`.
- Closure config check: `bun run verify:deployed-config -- --cdk-outputs packages/cdk/cdk-outputs.json`.
- Remove the exit-code table, the `--phase ios-physical-preflight --device-id` example, the `--require-deployed-config` closure-run note, and any "append-only evidence" claim.
- State that manifests are local/ephemeral and only `m1-ios-foundation-verification.md` is the committed record.

- [ ] **Step 5: Repoint the production-diagnostics comment**

In `apps/vela-mobile/scripts/verify-production-diagnostics.mjs` line ~11, replace `pass --require-deployed-config to bun run verify:m1-foundation for that check` with `run bun run verify:deployed-config -- --cdk-outputs packages/cdk/cdk-outputs.json for that check`.

- [ ] **Step 6: Update `CLAUDE.md`**

- Lines ~198–203: reword the HPA-210 status from "physical preflight is `prerequisite_missing`" to "physical acceptance is deferred; the automated phase passed on the cleanup head" (no preflight reference).
- Lines ~220–222: remove "selected HPA-210 automated and Simulator manifests do not replace those physical observations" — reword to "the automated gate does not replace physical observations".

- [ ] **Step 7: Add supersession notice to the 2026-08-02 design doc**

At the very top of `docs/superpowers/specs/2026-08-02-mobile-ios-foundation-verification-design.md`, insert:

```markdown
> **SUPERSEDED (partially) by `2026-08-04-hpa210-evidence-cleanup-design.md`.**
> The manifest-contract schema, the `ios-simulator` / `ios-physical-preflight` /
> `manual` phases, cross-phase linkage, evidence hashes, and the in-manifest
> deployed-config check are replaced. **Retained**: the closure requirement for
> deployed-config consistency (now via the standalone `verify:deployed-config`)
> and the eight-gate automated definition. Physical acceptance remains a manual
> matrix criterion in both docs.
```

- [ ] **Step 8: Link sweep (verification gate)**

Run from repo root:

```bash
rg -n "evidence/hpa-210/.*manifest\.json|--require-deployed-config|--phase ios-physical-preflight|--record-manual|linkedAutomatedRunId" --glob '!docs/superpowers/**' --glob '!.artifacts/**'
```

Expected: no matches in tracked files (matches only inside gitignored `.artifacts/` or superseded design docs are acceptable; review any hit).

- [ ] **Step 9: Commit (stage only; user approves)**

```bash
git add -A
git commit -m "docs(mobile): delink HPA-210 evidence; rewrite verification docs for minimal runner"
```

---

## Task 5: Final verification — run gate on cleanup head, set testedCommit

**Files:**

- Modify: `apps/vela-mobile/docs/m1-ios-foundation-verification.md` (fill `<SHA>` placeholder from Task 4 Step 1)

**Interfaces:** None. This is the evidence-before-assertions gate for the whole plan (arch-review P1-3).

- [ ] **Step 1: Run the full gate end-to-end on the cleanup head**

From repo root:

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation
```

Expected: exit 0; a manifest written under `.artifacts/hpa-210/<HEAD-SHA>/<runId>/manifest.json` with `outcome: "passed"`. Capture `<HEAD-SHA>` and `<runId>`.

If it fails: do not claim done. Debug (systematic-debugging skill), fix, rerun.

- [ ] **Step 2: Fill the testedCommit in the decision record**

In `apps/vela-mobile/docs/m1-ios-foundation-verification.md`, replace the `<SHA>` placeholder (Task 4 Step 1) with the actual cleanup-head SHA from Step 1. Verify the `runId`-derivable receipt exists locally.

- [ ] **Step 3: Run the deployed-config verifier (placeholder-aware)**

```bash
bun run --cwd apps/vela-mobile verify:deployed-config
```

Expected: either exit 0 (if real `.env.production` present) or exit 1 with a clear "Missing mobile build identifier" / placeholder message. Either is acceptable for the cleanup PR (closure run uses `--cdk-outputs`). Record the actual outcome in the decision record's deployed-config row.

- [ ] **Step 4: Full quality gate**

From repo root:

```bash
bun run lint && bun run typecheck && bun run test
```

Expected: all PASS. (Per AGENTS.md, root `bun run typecheck` runs `@vela/mobile`; if any package lacks the script Turbo skips it.)

- [ ] **Step 5: Commit (stage only; user approves)**

```bash
git add apps/vela-mobile/docs/m1-ios-foundation-verification.md
git commit -m "docs(mobile): record cleanup-head testedCommit in M1 verification decision"
```

- [ ] **Step 6: Final summary to user**

Report: cleanup-head SHA, gate outcome, deployed-config outcome, number of untracked evidence files, confirmation that no tracked `.md` links to `evidence/hpa-210/...`. Do NOT merge or push without explicit instruction.

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 schema → Task 2 Step 4; §2 harness → Task 2; §3 output path → Task 2 Step 4 (`DEFAULT_EVIDENCE_DIR_RELATIVE`) + Task 3; §4 config verifier → Task 1; §5 repo cleanup → Task 3; §6 doc rewrite → Task 4; §7 manual checklist → Task 4 Step 1; §8 rerun on cleanup head → Task 5. All spec sections mapped.
- **Placeholder scan:** `<implementer: paste ...>` markers in Task 2 Step 4 reference verbatim bodies in the file being overwritten — these are explicit carry-over instructions, not unfilled design. `cdxIdx` typo in Task 1 Step 3 is flagged. `<SHA>` in Task 4 is intentionally deferred to Task 5 Step 2 (cannot know cleanup-head SHA until then).
- **Type consistency:** `M1Arguments.evidenceDir?: string` (Task 2 parse + orchestrator); `M1Manifest.schemaVersion: 2`, `phase: 'automated'`, `outcome: 'passed'|'failed'`, `exitCode: 0|1` (Task 2, used by Task 5 Step 1); preserved CLI exports match `scripts/verify-m1-foundation.mjs` imports. `verifyDeployedConfig` signature matches Task 1 test + Task 5 Step 3 invocation.
