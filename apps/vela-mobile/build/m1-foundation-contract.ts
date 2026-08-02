import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

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

export const M1_EXIT_CODE: Readonly<Record<M1Outcome, 0 | 1 | 2 | 3 | 4>> = Object.freeze({
  passed: 0,
  harness_error: 1,
  usage_error: 2,
  prerequisite_missing: 3,
  gate_failed: 4,
});
const EXIT_CODES: ReadonlySet<number> = new Set(Object.values(M1_EXIT_CODE));

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
    publicIdentifiersConsistent: boolean;
  };
  host: Record<string, string | number | boolean>;
  commands: M1CommandResult[];
  evidence: M1EvidenceReference[];
  findings: Array<{ severity: string; issue?: string; summary: string }>;
};

const PHASES: ReadonlySet<M1Phase> = new Set([
  'automated',
  'ios-simulator',
  'ios-physical-preflight',
  'manual',
]);
const MATRIX_CLASSES: ReadonlySet<M1MatrixClass> = new Set([
  'automated',
  'production-smoke',
  'diagnostic-observation',
  'physical-preflight',
]);
const OUTCOMES: ReadonlySet<M1Outcome> = new Set([
  'passed',
  'usage_error',
  'prerequisite_missing',
  'gate_failed',
  'harness_error',
]);
const CONFIG_SOURCES = new Set(['.env.production', 'process_env', 'none']);
const CONFIG_CLASSES = new Set(['deployed', 'placeholder', 'missing']);
const EVIDENCE_KINDS = new Set(['committed', 'attachment', 'local-hash']);
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const RUN_ID_PATTERN = /^\d{8}T\d{6}Z-[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const PATH_SEPARATOR_PATTERN = /[\\/]/u;

type UnknownRecord = Record<string, unknown>;

function assertRecord(value: unknown, label: string): asserts value is UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertOnlyKeys(value: UnknownRecord, label: string, allowedKeys: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains unsupported field: ${key}`);
    }
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function assertEnum<T extends string>(
  value: unknown,
  label: string,
  allowedValues: ReadonlySet<T>,
): asserts value is T {
  if (typeof value !== 'string' || !allowedValues.has(value as T)) {
    throw new Error(`${label} is not supported`);
  }
}

function assertTimestamp(value: unknown, label: string): number {
  assertNonEmptyString(value, label);
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return milliseconds;
}

function assertTestedBehaviorCommit(value: unknown): asserts value is string {
  assertNonEmptyString(value, 'testedBehaviorCommit');
  if (!COMMIT_PATTERN.test(value)) {
    throw new Error('testedBehaviorCommit must be a 40-character lowercase hexadecimal commit');
  }
}

function assertSafePathSegment(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (PATH_SEPARATOR_PATTERN.test(value)) {
    throw new Error(`${label} must not contain a path separator`);
  }
}

function assertRunId(value: unknown): asserts value is string {
  assertSafePathSegment(value, 'runId');
  if (!RUN_ID_PATTERN.test(value)) {
    throw new Error('runId must use the UTC run ID format');
  }
}

function assertMatrixClass(value: unknown): asserts value is M1MatrixClass {
  assertSafePathSegment(value, 'matrixClass');
  assertEnum(value, 'matrixClass', MATRIX_CLASSES);
}

function validateConfig(value: unknown): void {
  assertRecord(value, 'config');
  assertOnlyKeys(value, 'config', [
    'source',
    'class',
    'apiOrigin',
    'region',
    'oauthDomain',
    'publicIdentifiersConsistent',
  ]);
  assertEnum(value.source, 'config.source', CONFIG_SOURCES);
  assertEnum(value.class, 'config.class', CONFIG_CLASSES);
  if (value.apiOrigin !== undefined) assertNonEmptyString(value.apiOrigin, 'config.apiOrigin');
  if (value.region !== undefined) assertNonEmptyString(value.region, 'config.region');
  if (value.oauthDomain !== undefined) assertNonEmptyString(value.oauthDomain, 'config.oauthDomain');
  if (typeof value.publicIdentifiersConsistent !== 'boolean') {
    throw new Error('config.publicIdentifiersConsistent must be a boolean');
  }
}

function validateHost(value: unknown): void {
  assertRecord(value, 'host');
  for (const [key, field] of Object.entries(value)) {
    assertNonEmptyString(key, 'host field name');
    if (
      typeof field !== 'string' &&
      typeof field !== 'number' &&
      typeof field !== 'boolean'
    ) {
      throw new Error(`host.${key} must be a string, number, or boolean`);
    }
    if (typeof field === 'number' && !Number.isFinite(field)) {
      throw new Error(`host.${key} must be a finite number`);
    }
  }
}

function validateCommandResult(value: unknown, index: number): void {
  const label = `commands[${index}]`;
  assertRecord(value, label);
  assertOnlyKeys(value, label, [
    'label',
    'command',
    'cwd',
    'startedAt',
    'endedAt',
    'elapsedMs',
    'exitCode',
    'status',
  ]);
  assertNonEmptyString(value.label, `${label}.label`);
  assertNonEmptyString(value.command, `${label}.command`);
  assertNonEmptyString(value.cwd, `${label}.cwd`);
  const startedAt = assertTimestamp(value.startedAt, `${label}.startedAt`);
  const endedAt = assertTimestamp(value.endedAt, `${label}.endedAt`);
  if (endedAt < startedAt) {
    throw new Error(`${label}.endedAt must not precede startedAt`);
  }
  assertNonNegativeInteger(value.elapsedMs, `${label}.elapsedMs`);
  assertFiniteNumber(value.exitCode, `${label}.exitCode`);
  if (!Number.isSafeInteger(value.exitCode)) {
    throw new Error(`${label}.exitCode must be a safe integer`);
  }
  if (value.status !== 'passed' && value.status !== 'failed') {
    throw new Error(`${label}.status must be passed or failed`);
  }
  if ((value.status === 'passed') !== (value.exitCode === 0)) {
    throw new Error(`${label}.status must agree with exitCode`);
  }
}

function validateEvidenceReference(value: unknown, index: number): void {
  const label = `evidence[${index}]`;
  assertRecord(value, label);
  assertOnlyKeys(value, label, ['kind', 'location', 'mediaType', 'byteSize', 'sha256']);
  assertEnum(value.kind, `${label}.kind`, EVIDENCE_KINDS);
  assertNonEmptyString(value.location, `${label}.location`);
  assertNonEmptyString(value.mediaType, `${label}.mediaType`);
  assertNonNegativeInteger(value.byteSize, `${label}.byteSize`);
  assertNonEmptyString(value.sha256, `${label}.sha256`);
  if (!SHA256_PATTERN.test(value.sha256)) {
    throw new Error(`${label}.sha256 must be a lowercase SHA-256 digest`);
  }
}

function validateFinding(value: unknown, index: number): void {
  const label = `findings[${index}]`;
  assertRecord(value, label);
  assertOnlyKeys(value, label, ['severity', 'issue', 'summary']);
  assertNonEmptyString(value.severity, `${label}.severity`);
  if (value.issue !== undefined) assertNonEmptyString(value.issue, `${label}.issue`);
  assertNonEmptyString(value.summary, `${label}.summary`);
}

function formatUtcPart(value: number): string {
  return value.toString().padStart(2, '0');
}

/**
 * Creates a stable UTC run identifier. The matrix class is included only as a
 * safe path segment so every evidence run is readable without weakening the
 * full-commit directory boundary.
 */
export function createM1RunId(date: Date, matrixClass: M1MatrixClass): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('date must be a valid Date');
  }
  assertMatrixClass(matrixClass);

  return [
    date.getUTCFullYear().toString().padStart(4, '0'),
    formatUtcPart(date.getUTCMonth() + 1),
    formatUtcPart(date.getUTCDate()),
  ].join('') +
    `T${formatUtcPart(date.getUTCHours())}${formatUtcPart(date.getUTCMinutes())}${formatUtcPart(
      date.getUTCSeconds(),
    )}Z-${matrixClass}`;
}

/**
 * Computes the immutable evidence directory for one exact behavior commit.
 * Callers supply the tested executable commit explicitly; this function never
 * reads Git HEAD, so later documentation-only commits leave existing rows
 * valid under their original behavior-commit directory.
 */
export function createM1RunDirectory(input: {
  evidenceRoot: string;
  testedBehaviorCommit: string;
  runId: string;
}): string {
  assertNonEmptyString(input.evidenceRoot, 'evidenceRoot');
  assertTestedBehaviorCommit(input.testedBehaviorCommit);
  assertRunId(input.runId);

  return join(input.evidenceRoot, input.testedBehaviorCommit, input.runId);
}

export async function hashFile(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function listFilesRecursively(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(path)));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`hashDirectory does not support non-regular entry: ${entry.name}`);
    }
  }

  return files;
}

/**
 * Hashes the directory's regular files in a platform-independent order. Each
 * relative path and byte payload is NUL-delimited so same-content files at
 * different paths cannot produce the same directory identity.
 */
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

/**
 * Validates the durable, secret-free manifest envelope before it is persisted.
 * Evidence remains a reference with a digest and size rather than an inline
 * screenshot, video, archive, or command-output payload.
 */
export function validateM1Manifest(manifest: M1Manifest): M1Manifest {
  const value = manifest as unknown;
  assertRecord(value, 'manifest');
  assertOnlyKeys(value, 'manifest', [
    'schemaVersion',
    'runId',
    'testedBehaviorCommit',
    'phase',
    'matrixClass',
    'startedAt',
    'endedAt',
    'outcome',
    'exitCode',
    'config',
    'host',
    'commands',
    'evidence',
    'findings',
  ]);
  if (value.schemaVersion !== 1) {
    throw new Error('schemaVersion must be 1');
  }
  assertRunId(value.runId);
  assertTestedBehaviorCommit(value.testedBehaviorCommit);
  assertEnum(value.phase, 'phase', PHASES);
  assertMatrixClass(value.matrixClass);
  const startedAt = assertTimestamp(value.startedAt, 'startedAt');
  const endedAt = assertTimestamp(value.endedAt, 'endedAt');
  if (endedAt < startedAt) {
    throw new Error('endedAt must not precede startedAt');
  }
  assertEnum(value.outcome, 'outcome', OUTCOMES);
  assertFiniteNumber(value.exitCode, 'exitCode');
  if (!Number.isSafeInteger(value.exitCode) || !EXIT_CODES.has(value.exitCode)) {
    throw new Error('exitCode must be one of the M1 exit codes');
  }
  if (value.exitCode !== M1_EXIT_CODE[value.outcome]) {
    throw new Error('exitCode must agree with outcome');
  }
  validateConfig(value.config);
  validateHost(value.host);
  if (!Array.isArray(value.commands)) {
    throw new Error('commands must be an array');
  }
  value.commands.forEach(validateCommandResult);
  if (!Array.isArray(value.evidence)) {
    throw new Error('evidence must be an array');
  }
  value.evidence.forEach(validateEvidenceReference);
  if (!Array.isArray(value.findings)) {
    throw new Error('findings must be an array');
  }
  value.findings.forEach(validateFinding);

  return manifest;
}

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
