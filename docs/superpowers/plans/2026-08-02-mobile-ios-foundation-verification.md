# Mobile iOS Foundation Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable HPA-210 verification harness, collect production and diagnostic evidence on Simulator and a physical iPhone, record the tested iOS foundation architecture, and issue an auditable M1 `GO` or `NO-GO`.

**Architecture:** Keep verification policy in pure TypeScript modules under `apps/vela-mobile/build/`, expose thin Bun entry points under `apps/vela-mobile/scripts/`, and reuse the existing production-diagnostics build/scan path. Machine phases produce append-only manifests keyed by `testedBehaviorCommit`; production product behavior and development-only diagnostic behavior run as separate build classes on the same commit and deployed backend. Physical observations remain explicit manual matrices and cannot be inferred from automated or Simulator results.

**Tech Stack:** Bun 1.3.1+, Turborepo 2, TypeScript 5.6, Vitest 3, Vue 3, Quasar 2, Capacitor 7, Xcode 16+, `xcodebuild`, `xcrun simctl`, `xcrun devicectl`, iOS Simulator, physical iPhone, GitHub Actions, Linear.

## Global Constraints

- Pin every machine manifest and executable matrix row to one exact `testedBehaviorCommit`.
- Documentation-, manifest-, evidence-reference-, architecture-, and `CLAUDE.md`-only commits do not invalidate rows pinned to `testedBehaviorCommit`.
- Any change to executable source, native/build configuration, dependency locks, generated WebView assets, or verification tooling creates a new behavior commit and reruns affected gates.
- Require both native classes on the same behavior commit and deployed backend identity:
  - production smoke with Release/production assets and diagnostics excluded;
  - Debug diagnostic observation with development-only routes enabled.
- Require the five mobile build variables for closure runs: `VITE_MOBILE_API_URL`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID`, `VITE_COGNITO_OAUTH_DOMAIN`, and `VITE_AWS_REGION`.
- Forbid `MOBILE_SKIP_ENV_VALIDATION=true`, `example.invalid`, localhost, placeholder credentials, and mismatched backend/client configuration for closure evidence.
- Keep `apps/vela-mobile/scripts/verify-production-diagnostics.mjs` as the only forbidden-diagnostic-token implementation.
- Scan emitted text artifacts with extensions `.js`, `.mjs`, `.cjs`, `.html`, `.css`, `.json`, `.map`, `.txt`, `.svg`, and `.xml`; skip binary files.
- Keep production diagnostics compiled out; never relax `import.meta.env.DEV` route ownership to make physical validation easier.
- Require physical-iPhone evidence for fresh Google sign-in, warm/cold callback, relaunch restoration, due-count identity isolation, speaker audibility, silent mode, interruption, Japanese Kana IME, native swipe history, and sensor-region safe areas.
- Use a development-team-signed personal iPhone controlled by the tester; do not commit `DEVELOPMENT_TEAM`, provisioning profiles, UDIDs, account email addresses, or credential-bearing logs.
- Use harness exits exactly: `0 passed`, `2 usage_error`, `3 prerequisite_missing`, `4 gate_failed`, `1 harness_error`.
- Store manifests at `apps/vela-mobile/docs/evidence/hpa-210/<full-testedBehaviorCommit>/<run-id>/manifest.json`.
- Commit manifests and small bounded text evidence; reference screenshots, videos, raw logs, archives, and other growth-prone artifacts by storage location, byte size, media type, and SHA-256.
- Preserve the historical flat `apps/vela-mobile/docs/evidence/hpa-209/*.png` layout.
- After selecting and hashing production `src-capacitor/www`, forbid every Quasar iOS build command until the corresponding production smoke completes; only explicit `bunx cap sync ios` is allowed, with pre/post directory-hash equality.
- Keep the transient OAuth transaction (`state`, `codeVerifier`, `nonce`, `createdAt`) in Capacitor Preferences/iOS UserDefaults with the existing 10-minute TTL and cleanup lifecycle; do not migrate it during HPA-210.
- Permit High-severity reclassification only for the silent-mode-only audio-session fork after correct audible core playback, replay, decoding, and lifecycle recovery pass.
- Keep OAuth/session restoration, data isolation, IME, keyboard obstruction, safe-area failures, navigation traps, unaudible core playback, and `native player adapter required` as hard `NO-GO`.
- Keep permanent macOS CI, TestFlight, App Store distribution, full native UI automation, Android, SRS review implementation, and unrelated refactors out of scope.

---

## File Map

### Repository freeze coverage

- Modify `package.json` — add the root `compile` entry point.
- Modify `turbo.json` — define the `compile` task and dependency behavior.

### Production diagnostic scanner

- Modify `apps/vela-mobile/scripts/verify-production-diagnostics.mjs` — scan all emitted text-artifact classes.
- Modify `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs` — prove each supported extension and binary exclusion.

### Secret policy and scanner

- Create `apps/vela-mobile/build/mobile-secret-policy.ts` — single policy source for sentinels, regex rules, public identifiers, and redacted finding types.
- Create `apps/vela-mobile/build/mobile-secret-policy.test.ts`.
- Create `apps/vela-mobile/scripts/scan-mobile-secrets.mjs` — executable source/artifact/evidence scanner.
- Create `apps/vela-mobile/scripts/scan-mobile-secrets.test.mjs`.
- Modify `apps/vela-mobile/src/test/secret-leak-helpers.ts` — import and re-export shared sentinel policy.
- Modify `apps/vela-mobile/package.json` — add `scan:secrets`, `verify:m1-foundation`, and lint coverage for `scripts/`.
- Modify `eslint.config.js` only if the existing mobile JavaScript rule does not supply every Node global used by the new scripts.

### Manifest and harness

- Create `apps/vela-mobile/build/m1-foundation-contract.ts` — phases, outcomes, exit codes, manifest schema, run IDs, hashing, and path rules.
- Create `apps/vela-mobile/build/m1-foundation-contract.test.ts`.
- Create `apps/vela-mobile/build/m1-foundation-harness.ts` — dependency-injected orchestration for automated, Simulator, and physical-preflight phases.
- Create `apps/vela-mobile/build/m1-foundation-harness.test.ts`.
- Create `apps/vela-mobile/scripts/verify-m1-foundation.mjs` — thin CLI wrapper.

### Documentation and evidence

- Create `apps/vela-mobile/docs/ios-foundation-architecture.md`.
- Create `apps/vela-mobile/docs/m1-ios-foundation-verification.md`.
- Modify `apps/vela-mobile/README.md` — harness usage, build classes, signing preflight, and evidence layout.
- Modify `CLAUDE.md` at closeout — replace stale M2 OAuth guidance and link the final HPA-210 records.
- Modify `docs/superpowers/specs/2026-08-02-mobile-ios-foundation-verification-design.md` as the final pre-merge action — change the review status line.

---

### Task 1: Add Complete Monorepo Freeze Coverage

**Files:**

- Modify: `package.json`
- Modify: `turbo.json`

**Interfaces:**

- Produces root command: `bun run compile`.
- Produces Turbo task: `compile`, executed by workspaces that define a `compile` script.
- Consumers: `runAutomatedPhase()` in Task 5 and the final freeze run in Task 9.

- [ ] **Step 1: Verify the missing root command**

Run:

```bash
bun run compile
```

Expected: FAIL with Bun reporting that the root `compile` script does not exist.

- [ ] **Step 2: Add the root command**

Add this exact script beside `build` and `typecheck` in `package.json`:

```json
"compile": "turbo compile"
```

- [ ] **Step 3: Add the Turbo task**

Add this exact task to `turbo.json`:

```json
"compile": {
  "dependsOn": ["^build"],
  "outputs": []
}
```

The dependency ensures `@vela/common` and other upstream build outputs exist before API or extension compilation.

- [ ] **Step 4: Verify workspace participation**

Run:

```bash
bun run compile -- --dry=json > /tmp/vela-m1-compile-dry-run.json
```

Inspect the JSON and verify it includes at least:

```text
vela-api#compile
wxt-vue-starter#compile
```

Then run:

```bash
bun run compile
```

Expected: PASS with both API `tsc --noEmit` and extension `vue-tsc --noEmit` completing successfully.

- [ ] **Step 5: Commit**

```bash
git add package.json turbo.json
git commit -m "build: add monorepo compile gate"
```

---

### Task 2: Widen the Authoritative Production-Diagnostics Scanner

**Files:**

- Modify: `apps/vela-mobile/scripts/verify-production-diagnostics.mjs`
- Modify: `apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs`

**Interfaces:**

- Produces: `PRODUCTION_TEXT_ARTIFACT_EXTENSIONS`.
- Preserves: `findDiagnosticTokens(root, tokens)` and `findProductionDiagnosticTokens(root)`.
- Consumers: `verify:production-diagnostics` and Task 5 automated verification.

- [ ] **Step 1: Replace the JavaScript-only test with extension coverage**

Add this table to `verify-production-diagnostics.test.mjs`:

```js
const emittedTextExtensions = [
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
];

it.each(emittedTextExtensions)(
  'finds diagnostic tokens in emitted %s artifacts',
  async (extension) => {
    const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
    const artifact = join(root, `artifact${extension}`);
    const token = forbiddenTokens[0];
    await writeFile(artifact, `prefix ${token} suffix`);

    expect(await findDiagnosticTokens(root, [token])).toEqual([{ path: artifact, token }]);
  },
);

it('ignores unsupported and binary artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vela-prod-scan-'));
  const token = forbiddenTokens[0];
  await writeFile(join(root, 'image.png'), Buffer.from(token));
  await writeFile(join(root, 'archive.zip'), Buffer.from(token));

  expect(await findDiagnosticTokens(root, [token])).toEqual([]);
});
```

Remove the old test named `ignores non-JavaScript assets`.

- [ ] **Step 2: Run the focused test and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- scripts/verify-production-diagnostics.test.mjs
```

Expected: FAIL for `.html`, `.css`, `.json`, `.map`, `.txt`, `.svg`, and `.xml` because the scanner currently reads only `.js`.

- [ ] **Step 3: Implement the extension allowlist**

Use `extname` and export the exact allowlist:

```js
import { extname, relative, resolve } from 'node:path';

export const PRODUCTION_TEXT_ARTIFACT_EXTENSIONS = new Set([
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
]);
```

Replace the current file branch with:

```js
} else if (
  entry.isFile() &&
  PRODUCTION_TEXT_ARTIFACT_EXTENSIONS.has(extname(entry.name).toLowerCase())
) {
  const contents = await readFile(path, 'utf8');
  for (const token of tokens) {
    if (contents.includes(token)) matches.push({ path, token });
  }
}
```

Do not move or duplicate `PRODUCTION_FORBIDDEN_TOKENS`.

- [ ] **Step 4: Run the scanner tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- scripts/verify-production-diagnostics.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Run the real production scanner**

Use a configured production environment:

```bash
bun run --cwd apps/vela-mobile verify:production-diagnostics
```

Expected: PASS and report no forbidden diagnostic token under `src-capacitor/www`.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/vela-mobile/scripts/verify-production-diagnostics.mjs \
  apps/vela-mobile/scripts/verify-production-diagnostics.test.mjs
git commit -m "test(mobile): scan all production text assets"
```

---

### Task 3: Create One Mobile Secret Policy and Executable Scanner

**Files:**

- Create: `apps/vela-mobile/build/mobile-secret-policy.ts`
- Create: `apps/vela-mobile/build/mobile-secret-policy.test.ts`
- Create: `apps/vela-mobile/scripts/scan-mobile-secrets.mjs`
- Create: `apps/vela-mobile/scripts/scan-mobile-secrets.test.mjs`
- Modify: `apps/vela-mobile/src/test/secret-leak-helpers.ts`
- Modify: `apps/vela-mobile/package.json`
- Modify: `eslint.config.js` only when a new script global is not already covered

**Interfaces:**

- Produces:

```ts
export type MobileSecretRuleId =
  | 'secret_sentinel'
  | 'bearer_value'
  | 'jwt_value'
  | 'private_key'
  | 'aws_secret'
  | 'provider_key'
  | 'presigned_url';

export type MobileSecretFinding = {
  ruleId: MobileSecretRuleId;
  path: string;
  line: number;
  valueClass: string;
  fingerprint: string;
};

export const SECRET_SENTINELS: readonly string[];
export const LOG_AND_DOM_SENTINELS: readonly string[];
export const NON_SCHEMA_STORAGE_SENTINELS: readonly string[];
export const PUBLIC_CONFIGURATION_KEYS: ReadonlySet<string>;
export function scanMobileSecretText(input: { path: string; text: string }): MobileSecretFinding[];
```

- Produces executable: `bun run --cwd apps/vela-mobile scan:secrets -- --root <path>`.
- Consumers: runtime secret-leak tests, Task 5 automated phase, evidence pre-commit scan.

- [ ] **Step 1: Write policy tests**

Create `mobile-secret-policy.test.ts` with these cases:

```ts
import { PUBLIC_CONFIGURATION_KEYS, scanMobileSecretText } from './mobile-secret-policy';

it('finds a bearer credential without retaining its raw value', () => {
  const findings = scanMobileSecretText({
    path: 'captured.log',
    text: 'Authorization: Bearer SECRET-id-token',
  });

  expect(findings).toEqual([
    expect.objectContaining({
      ruleId: 'bearer_value',
      path: 'captured.log',
      line: 1,
      valueClass: 'authorization_bearer',
      fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }),
  ]);
  expect(JSON.stringify(findings)).not.toContain('SECRET-id-token');
});

it('allows public mobile configuration identifiers', () => {
  expect(PUBLIC_CONFIGURATION_KEYS).toEqual(
    new Set([
      'VITE_MOBILE_API_URL',
      'VITE_COGNITO_USER_POOL_ID',
      'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
      'VITE_COGNITO_OAUTH_DOMAIN',
      'VITE_AWS_REGION',
    ]),
  );
  expect(
    scanMobileSecretText({
      path: 'manifest.json',
      text: JSON.stringify({
        VITE_COGNITO_USER_POOL_ID: 'us-east-1_public',
        VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'public-client-id',
      }),
    }),
  ).toEqual([]);
});

it('finds a full presigned URL but allows an origin-only URL', () => {
  expect(
    scanMobileSecretText({
      path: 'audio.log',
      text: 'https://bucket.example/audio.mp3?X-Amz-Credential=secret&X-Amz-Signature=secret',
    }),
  ).toHaveLength(1);

  expect(
    scanMobileSecretText({
      path: 'manifest.json',
      text: 'https://api.example.test/api/',
    }),
  ).toEqual([]);
});
```

Add cases for JWT-shaped values, private-key headers, AWS secret key assignments, provider API keys, line-number calculation, known sentinels, and bounded false-positive classification.

- [ ] **Step 2: Run policy tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/mobile-secret-policy.test.ts
```

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the pure policy**

Implement redacted findings with SHA-256 fingerprints:

```ts
import { createHash } from 'node:crypto';

function finding(
  ruleId: MobileSecretRuleId,
  path: string,
  line: number,
  valueClass: string,
  rawValue: string,
): MobileSecretFinding {
  return {
    ruleId,
    path,
    line,
    valueClass,
    fingerprint: createHash('sha256').update(rawValue).digest('hex'),
  };
}
```

Move the existing sentinel arrays from `src/test/secret-leak-helpers.ts` into this module without changing their values. Define scanners for:

```ts
const BEARER_PATTERN = /Authorization:\s*Bearer\s+([^\s"'`]+)/giu;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu;
const PRESIGNED_URL_PATTERN =
  /https?:\/\/[^\s"'`?]+\?[^\s"'`]*(?:X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token)=[^\s"'`]*/giu;
```

Use key/value matching for AWS and provider secret assignments. Return only redacted findings.

- [ ] **Step 4: Adapt runtime secret-leak helpers**

Replace local sentinel declarations with imports and re-exports:

```ts
import {
  LOG_AND_DOM_SENTINELS,
  NON_SCHEMA_STORAGE_SENTINELS,
  SECRET_SENTINELS,
} from '../../build/mobile-secret-policy';

export { LOG_AND_DOM_SENTINELS, NON_SCHEMA_STORAGE_SENTINELS, SECRET_SENTINELS };
```

Keep `createSecretLeakAssertions()` behavior unchanged.

- [ ] **Step 5: Write executable-scanner tests**

Create temporary source, artifact, native-resource, log, and evidence roots:

```js
it('scans supported files and returns redacted findings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vela-secret-scan-'));
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
```

Add cases proving `node_modules`, `DerivedData`, archives, images, and files above the configured byte limit are skipped with a bounded skip record.

- [ ] **Step 6: Run scanner tests and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- scripts/scan-mobile-secrets.test.mjs
```

Expected: FAIL because `scan-mobile-secrets.mjs` does not exist.

- [ ] **Step 7: Implement the executable scanner**

Export:

```js
export async function scanMobileSecretRoots({
  roots,
  exclusions = ['node_modules', 'DerivedData', 'coverage', '.git'],
  maxTextBytes = 2 * 1024 * 1024,
}) {
  // recursively walk supported text files, call scanMobileSecretText(),
  // return { findings, skipped } with repository-relative paths
}
```

Use the same text-artifact extension set as Task 2 plus `.log`, `.md`, `.plist`, `.pbxproj`, `.xcconfig`, `.entitlements`, `.yaml`, and `.yml`. Never include matched raw values in output.

Define bounded fixture handling: files matching `*.test.*` or `*.spec.*` may contain only the explicit `SECRET-` sentinels and `.example.test` / `example.invalid` fixture values exported by the policy. A real-looking bearer value, JWT, private key, provider key, or AWS secret still fails in a test file. The policy module itself may define its exported sentinel literals without self-reporting them.

Implement CLI flags:

```text
--root <path>       repeatable
--json <path>       write redacted report
--max-bytes <n>     default 2097152
```

Exit `4` when findings exist, `2` for invalid arguments, and `1` for scanner failures.

- [ ] **Step 8: Add package scripts and lint coverage**

Change the mobile package scripts to:

```json
"scan:secrets": "bun run scripts/scan-mobile-secrets.mjs",
"verify:m1-foundation": "bun run scripts/verify-m1-foundation.mjs",
"lint": "eslint \"./src/**/*.{ts,js,vue}\" \"./build/**/*.{ts,js}\" \"./scripts/**/*.{mjs,js,ts}\""
```

The root ESLint config already applies Node globals to `apps/vela-mobile/**/*.{js,mjs}`. Modify it only if a new global is genuinely missing.

- [ ] **Step 9: Run focused and package tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  build/mobile-secret-policy.test.ts \
  scripts/scan-mobile-secrets.test.mjs \
  src/services/mobile-auth.test.ts \
  src/boot/mobile-auth.test.ts
bun run --cwd apps/vela-mobile lint
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  apps/vela-mobile/build/mobile-secret-policy.ts \
  apps/vela-mobile/build/mobile-secret-policy.test.ts \
  apps/vela-mobile/scripts/scan-mobile-secrets.mjs \
  apps/vela-mobile/scripts/scan-mobile-secrets.test.mjs \
  apps/vela-mobile/src/test/secret-leak-helpers.ts \
  apps/vela-mobile/package.json \
  eslint.config.js
git commit -m "feat(mobile): add shared secret scanning policy"
```

---

### Task 4: Define the Manifest, Run-ID, and Hashing Contract

**Files:**

- Create: `apps/vela-mobile/build/m1-foundation-contract.ts`
- Create: `apps/vela-mobile/build/m1-foundation-contract.test.ts`

**Interfaces:**

- Produces:

```ts
export type M1Phase = 'automated' | 'ios-simulator' | 'ios-physical-preflight' | 'manual';
export type M1MatrixClass =
  | 'automated'
  | 'production-smoke'
  | 'diagnostic-observation'
  | 'physical-preflight';
export type M1Outcome =
  | 'passed'
  | 'usage_error'
  | 'prerequisite_missing'
  | 'gate_failed'
  | 'harness_error';

export const M1_EXIT_CODE: Readonly<Record<M1Outcome, 0 | 1 | 2 | 3 | 4>>;

export type M1CommandResult = {
  label: string;
  command: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  exitCode: number;
  status: 'passed' | 'failed';
};

export type M1EvidenceReference = {
  kind: 'committed' | 'attachment' | 'local-hash';
  location: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
};

export type M1Manifest = {
  schemaVersion: 1;
  runId: string;
  testedBehaviorCommit: string;
  phase: M1Phase;
  matrixClass: M1MatrixClass;
  startedAt: string;
  endedAt: string;
  outcome: M1Outcome;
  exitCode: 0 | 1 | 2 | 3 | 4;
  config: {
    source: '.env.production' | 'process_env' | 'none';
    class: 'deployed' | 'placeholder' | 'missing';
    apiOrigin?: string;
    region?: string;
    oauthDomain?: string;
    cognitoUserPoolId?: string;
    cognitoMobileUserPoolClientId?: string;
    publicIdentifiersConsistent: boolean;
  };
  host: Record<string, string | number | boolean>;
  commands: M1CommandResult[];
  evidence: M1EvidenceReference[];
  findings: Array<{ severity: string; issue?: string; summary: string }>;
};
```

- Produces: `createM1RunId()`, `createM1RunDirectory()`, `hashFile()`, `hashDirectory()`, `validateM1Manifest()`, and `createManualM1Manifest()`.
- Consumers: Tasks 5–7 and evidence runs.

- [ ] **Step 1: Write contract tests**

```ts
import {
  M1_EXIT_CODE,
  createM1RunDirectory,
  createM1RunId,
  hashDirectory,
} from './m1-foundation-contract';

it('maps every outcome to the stable exit code', () => {
  expect(M1_EXIT_CODE).toEqual({
    passed: 0,
    harness_error: 1,
    usage_error: 2,
    prerequisite_missing: 3,
    gate_failed: 4,
  });
});

it('creates UTC run IDs', () => {
  expect(createM1RunId(new Date('2026-08-03T02:15:00.000Z'), 'production-smoke')).toBe(
    '20260803T021500Z-production-smoke',
  );
});

it('creates the versioned evidence path', () => {
  expect(
    createM1RunDirectory({
      evidenceRoot: '/repo/apps/vela-mobile/docs/evidence/hpa-210',
      testedBehaviorCommit: 'a'.repeat(40),
      runId: '20260803T021500Z-production-smoke',
    }),
  ).toBe(
    `/repo/apps/vela-mobile/docs/evidence/hpa-210/${'a'.repeat(40)}/20260803T021500Z-production-smoke`,
  );
});
```

Add hashing tests proving file-order independence, path inclusion, and changed-content detection.

- [ ] **Step 2: Run and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/m1-foundation-contract.test.ts
```

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement the contract**

Use normalized slash-separated relative paths when hashing directories so
digests are platform-independent:

```ts
export async function hashDirectory(root: string): Promise<string> {
  const files = await listFilesRecursively(root);
  const relativeFiles = files
    .map((file) => ({
      file,
      relativePath: relative(root, file).split(sep).join('/'),
    }))
    .sort((left, right) => {
      if (left.relativePath < right.relativePath) return -1;
      if (left.relativePath > right.relativePath) return 1;
      return 0;
    });
  const hash = createHash('sha256');

  for (const { file, relativePath } of relativeFiles) {
    hash.update(relativePath);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }

  return hash.digest('hex');
}
```

Reject non-40-character behavior commits and matrix classes containing path separators.

Implement manual manifest construction. Spread the caller input before the
forced fields so caller values cannot override the schema version, phase, exit
code, or empty commands array:

```ts
export function createManualM1Manifest(input: {
  testedBehaviorCommit: string;
  matrixClass: 'production-smoke' | 'diagnostic-observation';
  runId: string;
  startedAt: string;
  endedAt: string;
  config: M1Manifest['config'];
  host: M1Manifest['host'];
  evidence: M1EvidenceReference[];
  findings: M1Manifest['findings'];
  outcome: 'passed' | 'gate_failed' | 'prerequisite_missing';
}): M1Manifest {
  return validateM1Manifest({
    ...input,
    schemaVersion: 1,
    phase: 'manual',
    exitCode: M1_EXIT_CODE[input.outcome],
    commands: [],
  });
}
```

This helper lets Tasks 10–11 write manual run manifests under the original `testedBehaviorCommit` even after earlier manifest-only commits have advanced Git `HEAD`.

- [ ] **Step 4: Run contract tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/m1-foundation-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  apps/vela-mobile/build/m1-foundation-contract.ts \
  apps/vela-mobile/build/m1-foundation-contract.test.ts
git commit -m "feat(mobile): define M1 verification manifest"
```

---

### Task 5: Implement the CLI Core and Automated Phase

**Files:**

- Create: `apps/vela-mobile/build/m1-foundation-harness.ts`
- Create: `apps/vela-mobile/build/m1-foundation-harness.test.ts`
- Create: `apps/vela-mobile/scripts/verify-m1-foundation.mjs`
- Modify: `apps/vela-mobile/package.json`

**Interfaces:**

- Produces:

```ts
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

export type HarnessDependencies = {
  repoRoot: string;
  now: () => Date;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  runCommand: CommandRunner;
};

export function parseM1Arguments(argv: string[]):
  | {
      mode: 'verify';
      phase: 'automated' | 'ios-simulator' | 'ios-physical-preflight' | 'all';
      simulatorUdid?: string;
      deviceId?: string;
      requireDeployedConfig: boolean;
    }
  | {
      mode: 'record-manual';
      matrixClass: 'production-smoke' | 'diagnostic-observation';
      testedBehaviorCommit: string;
      inputPath: string;
    };

export async function runM1FoundationVerification(
  args: ReturnType<typeof parseM1Arguments>,
  dependencies: HarnessDependencies,
): Promise<M1Manifest[]>;
```

- Consumers: CLI wrapper and Tasks 6–7.

- [ ] **Step 1: Write CLI and command-order tests**

Test invalid phases, required argument pairing, exit mapping, and this exact automated command order:

```ts
const expectedCommands = [
  ['bun', ['install', '--frozen-lockfile']],
  ['bun', ['run', 'lint']],
  ['bun', ['run', 'typecheck']],
  ['bun', ['run', 'compile']],
  ['bun', ['run', 'build']],
  ['bun', ['run', 'test']],
  ['bun', ['run', '--cwd', 'apps/vela-mobile', 'verify:production-diagnostics']],
  ['bun', ['run', '--cwd', 'apps/vela-mobile', 'scan:secrets', '--', '--root', 'apps/vela-mobile']],
];
```

Add a test where command four fails and assert:

```ts
expect(manifest.outcome).toBe('gate_failed');
expect(manifest.exitCode).toBe(4);
expect(runner.calls).toHaveLength(4);
```

Add tests that a missing production configuration returns `prerequisite_missing` before any production build command and that `MOBILE_SKIP_ENV_VALIDATION=true` is rejected for deployed closure runs.

- [ ] **Step 2: Run and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/m1-foundation-harness.test.ts
```

Expected: FAIL because the harness module does not exist.

- [ ] **Step 3: Implement argument parsing**

Use exact accepted syntax:

```text
--phase automated
--phase ios-simulator --simulator-udid <UDID>
--phase ios-physical-preflight --device-id <CoreDevice identifier>
--phase all --simulator-udid <UDID> --device-id <CoreDevice identifier>
--record-manual production-smoke --tested-behavior-commit <SHA> --input <JSON>
--record-manual diagnostic-observation --tested-behavior-commit <SHA> --input <JSON>
```

Unknown flags, duplicate scalar flags, or missing values produce `usage_error`.

- [ ] **Step 4: Implement the command runner**

Use `spawn` with argument arrays and no shell:

```ts
export const spawnCommand: CommandRunner = async (spec) =>
  new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // bound stdout/stderr capture to 64 KiB each; resolve on close
  });
```

Never copy complete environments into manifests.

- [ ] **Step 5: Reuse the production configuration validator**

Import:

```ts
import { loadMobileBuildEnv, validateMobileBuildEnv } from './validate-mobile-api-url';
```

Classify:

```ts
function classifyMobileConfig(env: ReturnType<typeof loadMobileBuildEnv>) {
  const values = Object.values(env).filter((value): value is string => typeof value === 'string');
  const placeholder = values.some((value) =>
    /(?:example\.invalid|localhost|ciPlaceholder|ci-placeholder|placeholder)/iu.test(value),
  );

  return placeholder ? 'placeholder' : 'deployed';
}
```

For the final harness, `automated` may emit placeholder manifests in CI, but a deployed closure run must pass an explicit `--require-deployed-config` flag. Add this flag to parsing and use it for Task 9.

- [ ] **Step 6: Implement automated orchestration**

For each command:

- record ISO timestamps and elapsed milliseconds;
- store only bounded, secret-scanned output as external evidence when needed;
- stop at the first failure;
- always write `manifest.json` in the computed run directory;
- return exit `4` for failed gates and exit `1` only for unexpected harness failures.

The scanner command must include the generated `src-capacitor/www`, native project resources, and the current HPA-210 run directory after production assets exist.

- [ ] **Step 7: Implement the thin CLI**

`verify-m1-foundation.mjs` should only:

```js
import { fileURLToPath } from 'node:url';
import {
  parseM1Arguments,
  runM1FoundationVerification,
  spawnCommand,
} from '../build/m1-foundation-harness.ts';

const args = parseM1Arguments(process.argv.slice(2));
const manifests = await runM1FoundationVerification(args, {
  repoRoot: fileURLToPath(new URL('../../..', import.meta.url)),
  now: () => new Date(),
  platform: process.platform,
  env: process.env,
  runCommand: spawnCommand,
});
process.exit(manifests.at(-1)?.exitCode ?? 1);
```

Wrap usage errors so they exit `2` and write no misleading pass manifest.

For `mode: 'record-manual'`, read a secret-free JSON input containing timestamps, environment aliases, evidence references, findings, config classification, and the observed outcome. Call `createManualM1Manifest()`, write it under the supplied behavior commit/run ID, and reject any input that contains raw OAuth values, tokens, email addresses, device identifiers, or unhashed binary evidence.

- [ ] **Step 8: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  build/m1-foundation-harness.test.ts \
  build/m1-foundation-contract.test.ts \
  scripts/scan-mobile-secrets.test.mjs
bun run --cwd apps/vela-mobile lint
```

Expected: PASS.

- [ ] **Step 9: Run a placeholder automated smoke**

Use the same five harmless placeholders as PR CI:

```bash
VITE_MOBILE_API_URL=https://example.invalid/api/ \
VITE_COGNITO_USER_POOL_ID=us-east-1_ciPlaceholder \
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=ci-mobile-client-id \
VITE_COGNITO_OAUTH_DOMAIN=ci-placeholder.auth.us-east-1.amazoncognito.com \
VITE_AWS_REGION=us-east-1 \
bun run --cwd apps/vela-mobile verify:m1-foundation -- --phase automated
```

Expected: machine gates run, manifest class is `placeholder`, and this run is explicitly ineligible for `GO`.

- [ ] **Step 10: Commit**

```bash
git add \
  apps/vela-mobile/build/m1-foundation-harness.ts \
  apps/vela-mobile/build/m1-foundation-harness.test.ts \
  apps/vela-mobile/scripts/verify-m1-foundation.mjs \
  apps/vela-mobile/package.json
git commit -m "feat(mobile): add M1 automated verification"
```

---

### Task 6: Add Simulator Build, Install, Launch, and Asset-Immutability Checks

**Files:**

- Modify: `apps/vela-mobile/build/m1-foundation-harness.ts`
- Modify: `apps/vela-mobile/build/m1-foundation-harness.test.ts`

**Interfaces:**

- Produces: `runIosSimulatorPhase()`.
- Consumes: `hashDirectory()`, `CommandRunner`, production manifest/config contract.
- Produces Simulator manifest host fields: `simulatorAlias`, `simulatorRuntime`, `xcodeVersion`, `appBundlePath`, and pre/post `www` hashes.

- [ ] **Step 1: Write Simulator sequencing tests**

Use a fake runner and assert this sequence:

```text
git rev-parse HEAD
xcodebuild -version
xcrun simctl list devices available --json
bun run --cwd apps/vela-mobile verify:production-diagnostics
bunx cap sync ios
xcodebuild -showBuildSettings -json ...
xcodebuild ... -sdk iphonesimulator ... CODE_SIGNING_ALLOWED=NO build
xcrun simctl bootstatus <UDID> -b
xcrun simctl install <UDID> <App.app>
xcrun simctl launch <UDID> com.vela.app
xcrun simctl spawn <UDID> ps -A -o comm=
```

Assert that a changed post-sync `www` hash returns `gate_failed` before `xcodebuild`.

- [ ] **Step 2: Run and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/m1-foundation-harness.test.ts
```

Expected: FAIL because the Simulator phase is not implemented.

- [ ] **Step 3: Implement Simulator discovery and preflight**

Require macOS and an explicit `--simulator-udid`. Parse `simctl list devices available --json` and return exit `3` when the requested device or runtime is unavailable.

Record versions with:

```bash
xcodebuild -version
bun --version
bun pm ls quasar @capacitor/core @capacitor/ios @capacitor/app @capacitor/keyboard
```

- [ ] **Step 4: Preserve the verified WebView artifact**

After `verify:production-diagnostics`:

```ts
const wwwBefore = await hashDirectory(wwwRoot);
await runOrThrow({
  label: 'capacitor-sync-ios',
  command: 'bunx',
  args: ['cap', 'sync', 'ios'],
  cwd: capacitorRoot,
});
const wwwAfter = await hashDirectory(wwwRoot);

if (wwwBefore !== wwwAfter) {
  return failManifest('gate_failed', 'cap sync changed verified WebView assets');
}
```

Do not invoke `build:ios`, `build:ios:ide`, `build:ios:assets`, or `verify:production-diagnostics` again after recording `wwwBefore`.

- [ ] **Step 5: Build and locate the Simulator app**

Run:

```bash
xcodebuild \
  -workspace apps/vela-mobile/src-capacitor/ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=<UDID>" \
  -derivedDataPath "<local-run-dir>/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Use `xcodebuild -showBuildSettings -json` to derive `TARGET_BUILD_DIR` and `WRAPPER_NAME`; do not guess the `.app` path.

- [ ] **Step 6: Install, launch, and assert process presence**

Run:

```bash
xcrun simctl bootstatus <UDID> -b
xcrun simctl install <UDID> <resolved-app-path>
xcrun simctl launch <UDID> com.vela.app
xcrun simctl spawn <UDID> ps -A -o comm=
```

Read `CFBundleExecutable` from the built `Info.plist` with `plutil -extract CFBundleExecutable raw`. Require the executable name in the bounded `ps` output after a five-second sleep.

- [ ] **Step 7: Run tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/m1-foundation-harness.test.ts
bun run --cwd apps/vela-mobile lint
```

Expected: PASS.

- [ ] **Step 8: Run on an available Simulator**

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation -- \
  --phase ios-simulator \
  --simulator-udid <available-simulator-udid> \
  --require-deployed-config
```

Expected: PASS only when deployed mobile configuration is present and the requested Simulator is available. A missing Simulator or Xcode exits `3`.

- [ ] **Step 9: Commit**

```bash
git add \
  apps/vela-mobile/build/m1-foundation-harness.ts \
  apps/vela-mobile/build/m1-foundation-harness.test.ts
git commit -m "feat(mobile): verify iOS Simulator launch"
```

---

### Task 7: Add Physical-Device and Signing Preflight

**Files:**

- Modify: `apps/vela-mobile/build/m1-foundation-harness.ts`
- Modify: `apps/vela-mobile/build/m1-foundation-harness.test.ts`

**Interfaces:**

- Produces: `runIosPhysicalPreflightPhase()`.
- Consumes: explicit `--device-id`, local Xcode signing configuration, deployed config.
- Produces only non-secret device alias/model and signing readiness.

- [ ] **Step 1: Write physical-preflight tests**

Add fake-runner tests for:

- non-macOS returns `prerequisite_missing`;
- device absent returns exit `3`;
- untrusted or unavailable device returns exit `3`;
- empty `DEVELOPMENT_TEAM` returns exit `3`;
- automatic signing plus non-empty team returns `passed`;
- raw CoreDevice identifiers and team IDs never appear in the manifest.

Expected command shape:

```text
xcrun devicectl list devices --json-output <local-temp-file>
xcodebuild -showBuildSettings -json
  -workspace .../App.xcworkspace
  -scheme App
  -configuration Debug
  -destination id=<device-id>
```

- [ ] **Step 2: Run and verify red**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/m1-foundation-harness.test.ts
```

Expected: FAIL because the physical preflight is not implemented.

- [ ] **Step 3: Implement device discovery**

Write `devicectl` JSON to a local temporary path outside committed evidence, parse only:

```ts
type PhysicalDeviceSummary = {
  alias: string;
  model: string;
  available: boolean;
  trusted: boolean;
  developerMode: boolean;
};
```

Delete the raw JSON after parsing. Never copy the device identifier into `manifest.json`.

- [ ] **Step 4: Implement signing readiness**

Parse `xcodebuild -showBuildSettings -json` and require:

```text
CODE_SIGN_STYLE = Automatic
DEVELOPMENT_TEAM = non-empty
PRODUCT_BUNDLE_IDENTIFIER = com.vela.app
```

The team may be supplied by Xcode user settings, an untracked xcconfig, or an explicit local build argument. Do not update `project.pbxproj` with a team.

- [ ] **Step 5: Run tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- build/m1-foundation-harness.test.ts
bun run --cwd apps/vela-mobile lint
```

Expected: PASS.

- [ ] **Step 6: Run physical preflight**

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation -- \
  --phase ios-physical-preflight \
  --device-id <connected-device-id> \
  --require-deployed-config
```

Expected: `passed` when device, trust, Developer Mode, signing, and provisioning resolve; otherwise exit `3` without a product-failure finding.

- [ ] **Step 7: Commit**

```bash
git add \
  apps/vela-mobile/build/m1-foundation-harness.ts \
  apps/vela-mobile/build/m1-foundation-harness.test.ts
git commit -m "feat(mobile): verify physical iOS readiness"
```

---

### Task 8: Add Verification and Architecture Record Schemas

**Files:**

- Create: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Create: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify: `apps/vela-mobile/README.md`

**Interfaces:**

- Produces the stable architecture destination and the append-only result schema.
- Consumers: Tasks 9–12 and HPA-202/HPA-205–HPA-210 closeout.

- [ ] **Step 1: Create the architecture record with unset measured conclusions**

Use these exact headings:

```markdown
# iOS Foundation Architecture

## Tested Revision

## Authentication and OAuth Callback

## OAuth Transaction Storage

## Session Storage and Restoration

## API Origin and Authenticated Transport

## User-Scoped Query Isolation

## Shared App Lifecycle

## Safe Areas, Keyboard, and Navigation

## Audio Adapter Decision

## Development Diagnostics and Production Exclusion

## Accepted Constraints

## Change Policy
```

Under `OAuth Transaction Storage`, record the current boundary:

```markdown
The transient OAuth transaction contains `state`, `codeVerifier`, `nonce`, and
`createdAt`. It is serialized as one JSON value through
`@capacitor/preferences`, backed by iOS UserDefaults, with a 10-minute TTL.
It contains no access, ID, or refresh token. The coordinator clears it after
consumption, cancellation, OAuth errors, restoration cleanup, and terminal
cleanup. UserDefaults is plaintext and may participate in device backup; M1
accepts this for short-lived, single-use correlation and verifier material,
not as an authenticated session store.
```

Set `Audio Adapter Decision` to `Pending physical HPA-210 evidence`; do not preselect an outcome.

- [ ] **Step 2: Create the verification record schema**

Use these sections:

```markdown
# M1 iOS Foundation Verification

## Final Decision

## Tested Behavior Commit

## Selected Run Manifests

## Production Smoke Matrix

## Diagnostic Observation Matrix

## Physical iPhone Matrix

## Security and Secret Scan

## Architecture Decision Summary

## Findings and Follow-up Issues

## Source-Issue Closure Mapping

## Milestone 2 Recommendation
```

Use this row schema for every matrix:

```markdown
| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |
```

Leave result rows absent rather than adding predeclared `PASS` or `unrun` rows.

- [ ] **Step 3: Document evidence references**

Add:

```markdown
Evidence manifests are committed under
`docs/evidence/hpa-210/<testedBehaviorCommit>/<run-id>/manifest.json`.
Screenshots, video, raw logs, and archives are attached externally unless a
small binary is uniquely load-bearing. External evidence is referenced by
location, byte size, media type, and SHA-256.
```

State that HPA-209 retains its historical flat evidence layout.

- [ ] **Step 4: Update the mobile README**

Add commands for:

```bash
bun run verify:m1-foundation -- --phase automated
bun run verify:m1-foundation -- --phase ios-simulator --simulator-udid <id>
bun run verify:m1-foundation -- --phase ios-physical-preflight --device-id <id>
```

Document the two build classes, deployed-config requirement, exit-code meanings, no committed development team, and the ban on Quasar rebuilds after production `www` hashing.

- [ ] **Step 5: Check documentation formatting**

```bash
bunx prettier --check \
  apps/vela-mobile/docs/ios-foundation-architecture.md \
  apps/vela-mobile/docs/m1-ios-foundation-verification.md \
  apps/vela-mobile/README.md
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  apps/vela-mobile/docs/ios-foundation-architecture.md \
  apps/vela-mobile/docs/m1-ios-foundation-verification.md \
  apps/vela-mobile/README.md
git commit -m "docs(mobile): add M1 verification records"
```

---

### Task 9: Freeze the Executable Verification Commit and Run Machine Gates

**Files:**

- Create through harness: `apps/vela-mobile/docs/evidence/hpa-210/<testedBehaviorCommit>/<run-id>/manifest.json`
- Modify only when a machine gate finds a defect: files owned by Tasks 1–8

**Interfaces:**

- Produces: final candidate `testedBehaviorCommit`.
- Produces successful deployed manifests for `automated`, `ios-simulator`, and `ios-physical-preflight`.
- Consumers: Tasks 10–12.

- [ ] **Step 1: Run focused verification before the freeze**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  build/mobile-secret-policy.test.ts \
  build/m1-foundation-contract.test.ts \
  build/m1-foundation-harness.test.ts \
  scripts/scan-mobile-secrets.test.mjs \
  scripts/verify-production-diagnostics.test.mjs
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 2: Run fresh root gates**

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run compile
bun run build
bun run test
```

Expected: every command exits `0`. Record actual Turbo tasks; do not claim lint/typecheck coverage for skipped workspaces.

- [ ] **Step 3: Commit any gate fixes and select the behavior commit**

When Steps 1–2 require code, config, lock, generated-asset, or harness changes:

```bash
git add <exact changed files>
git commit -m "fix(mobile): satisfy M1 verification gates"
```

Then record:

```bash
TESTED_BEHAVIOR_COMMIT="$(git rev-parse HEAD)"
printf '%s\n' "$TESTED_BEHAVIOR_COMMIT"
```

Do not amend or rebase this commit after native evidence begins.

- [ ] **Step 4: Run the deployed automated phase**

With deployed mobile configuration available:

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation -- \
  --phase automated \
  --require-deployed-config
```

Expected: `passed`, config class `deployed`, manifest `testedBehaviorCommit` equals `$TESTED_BEHAVIOR_COMMIT`.

- [ ] **Step 5: Run the Simulator phase**

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation -- \
  --phase ios-simulator \
  --simulator-udid <selected-simulator-udid> \
  --require-deployed-config
```

Expected: `passed`, pre/post `www` hashes equal, app installs and remains alive.

- [ ] **Step 6: Run the physical preflight**

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation -- \
  --phase ios-physical-preflight \
  --device-id <connected-device-id> \
  --require-deployed-config
```

Expected: `passed` with device alias/model and signing readiness, without UDID or team value in the manifest.

- [ ] **Step 7: Scan generated manifests and staged evidence**

```bash
bun run --cwd apps/vela-mobile scan:secrets -- \
  --root apps/vela-mobile/docs/evidence/hpa-210 \
  --json /tmp/hpa-210-evidence-secret-scan.json
```

Expected: no findings.

- [ ] **Step 8: Commit the machine manifests**

```bash
git add apps/vela-mobile/docs/evidence/hpa-210
git commit -m "test(mobile): record M1 machine verification"
```

This documentation/evidence-only commit does not change `$TESTED_BEHAVIOR_COMMIT`.

---

### Task 10: Run the Physical Production-Smoke Matrix

**Files:**

- Modify after observation: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Add manifests/text evidence under the selected behavior-commit directory
- Attach screenshots/logs externally and record hashes

**Interfaces:**

- Consumes: the scanned production `www` artifact and successful physical preflight from Task 9.
- Produces: physical production rows for installation, OAuth, restoration, due count, sign-out, and product-surface recovery.

- [ ] **Step 1: Build the signed Release target without rebuilding WebView assets**

Use Xcode or this command from the same checkout and existing synced native project:

```bash
xcodebuild \
  -workspace apps/vela-mobile/src-capacitor/ios/App/App.xcworkspace \
  -scheme App \
  -configuration Release \
  -destination "id=<connected-device-id>" \
  -derivedDataPath "<local-only-derived-data>" \
  -allowProvisioningUpdates \
  build
```

Do not run any Quasar build command before this build. Re-hash `src-capacitor/www` immediately before installation and require it to equal the Task 9 production manifest hash.

- [ ] **Step 2: Install and launch on the physical iPhone**

Use Xcode Run or `devicectl` with the resolved `.app`. Record:

- non-secret device alias and model;
- iOS and Xcode versions;
- app version/build;
- `$TESTED_BEHAVIOR_COMMIT`;
- production manifest run ID;
- deployed API origin, region, and OAuth domain;
- non-secret account alias.

- [ ] **Step 3: Execute the authentication lifecycle**

Run and record separate rows for:

```text
P-AUTH-01 fresh install and first launch
P-AUTH-02 fresh Google sign-in through the system browser
P-AUTH-03 direct-provider redirect
P-AUTH-04 warm callback
P-AUTH-05 cold-start callback
P-AUTH-06 user cancellation
P-AUTH-07 missing code
P-AUTH-08 provider error
P-AUTH-09 malformed callback
P-AUTH-10 state mismatch
P-AUTH-11 late or duplicate callback
P-AUTH-12 force-close and relaunch restoration
P-AUTH-13 proactive refresh
P-AUTH-14 resume refresh
P-AUTH-15 revoked/non-refreshable session
P-AUTH-16 sign-out
P-AUTH-17 signed-out relaunch
P-AUTH-18 reinstall residue cleanup
```

Every failure row includes reproduction, expected/observed behavior, severity, owner, target milestone, and Linear issue.

- [ ] **Step 4: Execute the due-count lifecycle**

Run and record:

```text
P-DUE-01 restored auth reaches Home
P-DUE-02 positive due_today
P-DUE-03 zero due_today
P-DUE-04 timestamped web/API comparison
P-DUE-05 loading and manual refresh
P-DUE-06 foreground refresh
P-DUE-07 disabled network and retry
P-DUE-08 request timeout
P-DUE-09 server failure
P-DUE-10 malformed response
P-DUE-11 rejected/expired-token recovery
P-DUE-12 terminal auth returns to gate
P-DUE-13 sign-out clears prior-user data
P-DUE-14 second account sees no prior cache
P-DUE-15 pending request does not block sign-out
```

For changing counts, record both observation timestamps instead of asserting later screenshot equality.

- [ ] **Step 5: Run product-surface security checks**

Confirm:

- no protected-content flash before restoration;
- no token, code, verifier, email, full callback URL, or presigned URL in visible UI or selected logs;
- development diagnostic labels/routes are absent from the Release build.

- [ ] **Step 6: Preserve evidence and write the manual run manifest**

For every external artifact, compute:

```bash
shasum -a 256 <artifact>
wc -c <artifact>
file --mime-type <artifact>
```

Record attachment/location, hash, size, and media type in a secret-free JSON input, then write the run manifest:

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation -- \
  --record-manual production-smoke \
  --tested-behavior-commit "$TESTED_BEHAVIOR_COMMIT" \
  --input /tmp/hpa-210-production-smoke.json
```

Verify the resulting manifest path is under the original behavior-commit directory and not the current documentation-only `HEAD`. Record the run ID in the verification record.

- [ ] **Step 7: Classify the production result**

Any failed OAuth/session restoration, due-count/data isolation, protected-content flash, or secret finding is a hard `NO-GO`. Create or update the corresponding Linear issue immediately.

---

### Task 11: Run the Physical Diagnostic-Observation Matrix

**Files:**

- Modify after observation: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify after audio decision: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Add manifests/text evidence under the selected behavior-commit directory
- Attach growth-prone artifacts externally

**Interfaces:**

- Consumes: the same `$TESTED_BEHAVIOR_COMMIT` and deployed backend identity as Task 10.
- Produces: TTS, IME, keyboard, safe-area, orientation, and navigation evidence plus the exact audio architecture conclusion.

- [ ] **Step 1: Start the Debug diagnostic build**

After Task 10 production smoke is complete:

```bash
cd apps/vela-mobile
bun run dev:ios
```

Use the same deployed API origin, user pool, mobile client, OAuth domain, and region. Keep the dev server running and launch the signed Debug target on the physical iPhone.

Record a new diagnostic-observation run ID; do not reuse the production manifest.

- [ ] **Step 2: Execute TTS controller and failure rows**

Run:

```text
D-TTS-01 restored authentication and configured settings
D-TTS-02 first server-cache request
D-TTS-03 genuinely uncached generation
D-TTS-04 loading/preparation state
D-TTS-05 first user-gesture playback
D-TTS-06 prepared direct-tap replay
D-TTS-07 ten prepared replays
D-TTS-08 rapid taps during preparation
D-TTS-09 rapid taps during playback
D-TTS-10 authentication failure
D-TTS-11 generation failure
D-TTS-12 disabled network and retry
D-TTS-13 expired/invalid presigned URL
D-TTS-14 decoding/playback failure
D-TTS-15 background during preparation
D-TTS-16 background during playback
D-TTS-17 foreground replayability
D-TTS-18 sign-out while ready
D-TTS-19 sign-out while playing
D-TTS-20 relaunch and replay
```

- [ ] **Step 3: Execute physical audio rows**

With built-in speaker and nonzero media volume, record human observations:

```text
D-AUDIO-01 correct audible pronunciation for 水 with silent mode off
D-AUDIO-02 ten replays without intermittent silence or overlap
D-AUDIO-03 external/system interruption leaves replayable state
D-AUDIO-04 silent mode on
```

On devices with a Ring/Silent switch, use it. On Action Button devices, configure the Action Button for Silent Mode or use the system Silent Mode control and confirm the system indicator. Focus mode is not the silent-mode control.

Select exactly one:

```text
HTML-only accepted
native audio-session integration required
native player adapter required
```

Only a silent-mode-only failure after all core playback rows pass may become the narrow High pre-M2 audio-session gate. `native player adapter required` is `NO-GO`.

- [ ] **Step 4: Execute Japanese IME rows**

Install the Japanese Kana keyboard and enter `にほんご`, selecting `日本語`. Record:

```text
D-IME-01 composition does not validate or submit early
D-IME-02 draft equals 日本語
D-IME-03 committed value equals 日本語
D-IME-04 bound model equals 日本語
D-IME-05 post-render native input equals 日本語
D-IME-06 submitted value equals 日本語
```

Any corruption or premature submission is a hard `NO-GO`.

- [ ] **Step 5: Execute keyboard, safe-area, and orientation rows**

Use a notched or Dynamic Island iPhone:

```text
D-LAYOUT-01 focused input visible in portrait
D-LAYOUT-02 primary action reachable in portrait
D-LAYOUT-03 focused input reachable in landscape left
D-LAYOUT-04 focused input reachable in landscape right
D-LAYOUT-05 keyboard dismissal restores footer once
D-LAYOUT-06 no stale keyboard gap
D-LAYOUT-07 top/bottom safe areas
D-LAYOUT-08 left/right landscape sensor-region avoidance
```

Link `ios-interaction-baseline.md` for historical rationale; do not copy its numeric tables.

- [ ] **Step 6: Execute navigation rows**

Run:

```text
D-NAV-01 visible back returns to exact prior route
D-NAV-02 native swipe back
D-NAV-03 native swipe forward
D-NAV-04 repeated tab switching
D-NAV-05 validated in-session deep entry
D-NAV-06 cold deep entry at depth zero
D-NAV-07 resume without new entry is a no-op
D-NAV-08 saved scroll restoration on back
D-NAV-09 saved scroll restoration on forward
D-NAV-10 no blank frame, app exit, duplicate page, or navigation trap
```

Any trap, unexpected exit, or broken physical swipe history is a hard `NO-GO`.

- [ ] **Step 7: Scan and preserve diagnostic evidence**

Run the secret scanner against bounded logs and evidence metadata before attachment or commit. Store only manifests and small text evidence in Git; attach images/video externally with hashes.

Write the manual diagnostic manifest:

```bash
bun run --cwd apps/vela-mobile verify:m1-foundation -- \
  --record-manual diagnostic-observation \
  --tested-behavior-commit "$TESTED_BEHAVIOR_COMMIT" \
  --input /tmp/hpa-210-diagnostic-observation.json
```

Require the manifest to use the same deployed backend identity and behavior commit as the production-smoke manifest.

- [ ] **Step 8: Update the architecture audio section**

Replace `Pending physical HPA-210 evidence` with the selected exact conclusion and the evidence run ID. Do not change unrelated architecture boundaries.

---

### Task 12: Finalize the Decision, Guidance, and Linear Closeout

**Files:**

- Modify: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Modify: `CLAUDE.md`
- Modify: `apps/vela-mobile/docs/ios-interaction-baseline.md` only when adding a concise closeout link/result
- Modify: `docs/superpowers/specs/2026-08-02-mobile-ios-foundation-verification-design.md` as the final pre-merge action
- Add: selected manifests and small bounded evidence under `apps/vela-mobile/docs/evidence/hpa-210/`

**Interfaces:**

- Produces final `GO` or `NO-GO`.
- Produces HPA-202/HPA-205–HPA-210 and HPA-194 updates.
- Produces the documentation/evidence commit linked externally to `testedBehaviorCommit`.

- [ ] **Step 1: Verify every required row**

Require:

- successful deployed automated, Simulator, and physical-preflight manifests;
- complete production-smoke and diagnostic-observation classes on the same `testedBehaviorCommit` and backend;
- physical OAuth, restoration, due count, audio, IME, keyboard, safe-area, and navigation rows;
- secret scan with no unresolved finding;
- exact audio conclusion;
- Linear issue for every deferred risk.

An unrun or `BLOCKED` required row produces `NO-GO` unless it is the narrow accepted silent-mode audio-session gate.

- [ ] **Step 2: Write the final decision**

Use exactly:

```markdown
## Final Decision

**Decision:** GO
```

or:

```markdown
## Final Decision

**Decision:** NO-GO
```

For `NO-GO`, list the minimum corrective issues and keep HPA-210 open.

- [ ] **Step 3: Finalize architecture from the behavior commit**

Record:

- `testedBehaviorCommit`;
- selected run IDs;
- implemented auth/session/API/query/lifecycle/layout boundaries;
- OAuth transaction UserDefaults boundary and accepted limitation;
- exact audio conclusion;
- links to HPA-209 historical baseline and HPA-210 final verification.

- [ ] **Step 4: Synchronize `CLAUDE.md`**

Replace the stale mobile section that says PKCE, `state`, `nonce`, mobile client wiring, and `identity_provider=Google` remain future M2 work. State that they are implemented, link the architecture record, and retain only current live/native limitations.

Point the HPA-209 physical-validation guidance to HPA-210’s final rows. Do not copy full matrices into `CLAUDE.md`.

- [ ] **Step 5: Update source Linear tickets**

For HPA-202 and HPA-205 through HPA-209, comment with:

- `testedBehaviorCommit`;
- relevant row IDs and run IDs;
- result;
- evidence links;
- follow-up issue when applicable.

Move a source issue to `Done` only when its acceptance evidence is satisfied.

- [ ] **Step 6: Update HPA-210 and HPA-194**

HPA-210 receives:

- `GO` or `NO-GO`;
- behavior commit;
- documentation/evidence commit;
- architecture and verification links;
- selected manifests;
- follow-up issues.

HPA-194 receives:

- concise M1 decision;
- device/build summary;
- accepted limitations;
- recommended first M2 issues.

For `GO`, recommend: Home/Review navigation, ten-card SRS session, rating/pronunciation behavior, then durable outbox and backend idempotency.

- [ ] **Step 7: Run final documentation and secret checks**

```bash
bunx prettier --check \
  apps/vela-mobile/docs/ios-foundation-architecture.md \
  apps/vela-mobile/docs/m1-ios-foundation-verification.md \
  apps/vela-mobile/README.md \
  CLAUDE.md \
  docs/superpowers/specs/2026-08-02-mobile-ios-foundation-verification-design.md

bun run --cwd apps/vela-mobile scan:secrets -- \
  --root apps/vela-mobile/docs/evidence/hpa-210 \
  --root apps/vela-mobile/docs/ios-foundation-architecture.md \
  --root apps/vela-mobile/docs/m1-ios-foundation-verification.md \
  --root CLAUDE.md
```

Expected: PASS with no secret findings.

- [ ] **Step 8: Update the design status as the final pre-merge edit**

Change:

```markdown
**Status:** Approved in project discussion; repository review in PR #56
```

to:

```markdown
**Status:** Approved
```

Do this only after the plan and design have completed repository review.

- [ ] **Step 9: Commit closeout documentation**

```bash
git add \
  apps/vela-mobile/docs/ios-foundation-architecture.md \
  apps/vela-mobile/docs/m1-ios-foundation-verification.md \
  apps/vela-mobile/docs/evidence/hpa-210 \
  apps/vela-mobile/docs/ios-interaction-baseline.md \
  apps/vela-mobile/README.md \
  CLAUDE.md \
  docs/superpowers/specs/2026-08-02-mobile-ios-foundation-verification-design.md
git commit -m "docs(mobile): record M1 iOS foundation decision"
```

Record this documentation commit in Linear. State explicitly that it does not invalidate executable rows pinned to `testedBehaviorCommit`.

- [ ] **Step 10: Final PR verification**

Run fresh:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run compile
bun run build
bun run test
```

If these commands modify executable inputs or reveal a required executable fix, create a new behavior commit and rerun the affected HPA-210 evidence rather than claiming the previous rows still apply.

---

## Plan Self-Review Checklist

- [x] Every design requirement maps to a task.
- [x] Root freeze coverage includes lint, typecheck, compile, build, and tests with actual Turbo participation recorded.
- [x] The production diagnostic scanner covers all emitted text-artifact classes without forking its token list.
- [x] One shared secret policy serves runtime tests and artifact/evidence scanning.
- [x] OAuth transaction Preferences/UserDefaults storage, TTL, cleanup, and threat-model rationale are explicit.
- [x] Manifest paths, schema, exit codes, redaction, hashes, and `testedBehaviorCommit` semantics are defined.
- [x] Production and diagnostic build classes run separately on one commit/backend.
- [x] Simulator results cannot substitute for physical acceptance.
- [x] Signing readiness is prerequisite handling and never commits a team or device identifier.
- [x] Verified `www` assets are hashed across `cap sync ios` and protected from Quasar rebuilds before production smoke.
- [x] Production, TTS, IME, layout, navigation, and failure scenarios have explicit row IDs.
- [x] The silent-mode-only audio gate is the sole High reclassification path.
- [x] Growth-prone evidence remains external with hash/size/media references.
- [x] HPA-209’s historical evidence layout remains unchanged.
- [x] `CLAUDE.md`, Linear source tickets, HPA-210, and HPA-194 have explicit closeout tasks.
- [x] The design status update is the final pre-merge action.
- [x] No unresolved implementation-value placeholder remains.

## Execution Handoff

After PR #56 is reviewed and merged, execute this plan using one of these paths:

1. **Subagent-Driven (recommended):** use `superpowers:subagent-driven-development`, dispatch a fresh implementation subagent per task, and run two-stage review between tasks.
2. **Inline Execution:** use `superpowers:executing-plans`, execute task batches in one session, and stop at the documented review checkpoints.
