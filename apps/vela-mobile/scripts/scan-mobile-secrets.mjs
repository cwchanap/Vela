import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { scanMobileSecretText } from '../build/mobile-secret-policy.ts';
import { PRODUCTION_TEXT_ARTIFACT_EXTENSIONS } from './verify-production-diagnostics.mjs';

const DEFAULT_EXCLUSIONS = ['node_modules', 'DerivedData', 'coverage', '.git', 'Pods'];
const MAX_SKIPPED_RECORDS = 1_000;
const MOBILE_SECRET_POLICY_SOURCE_PATH = fileURLToPath(
  new URL('../build/mobile-secret-policy.ts', import.meta.url),
);
const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export const MOBILE_SECRET_TEXT_ARTIFACT_EXTENSIONS = new Set([
  ...PRODUCTION_TEXT_ARTIFACT_EXTENSIONS,
  '.ts',
  '.tsx',
  '.mts',
  '.vue',
  '.scss',
  '.swift',
  '.m',
  '.h',
  '.log',
  '.md',
  '.plist',
  '.pbxproj',
  '.xcconfig',
  '.entitlements',
  '.yaml',
  '.yml',
]);

/**
 * Node's `extname` returns `''` for `.env` and `.production`/`.local` for
 * `.env.production`/`.env.local`, so the extension allowlist alone never
 * selects these files. Environment files are the primary location for
 * AWS/provider credential assignments, so they must reach the policy layer.
 * Matches `.env` exactly and any `.env.*` variant (`.env.production`,
 * `.env.local`, `.env.development`, etc.) but not names that merely contain
 * `.env` as a substring (e.g. `dotenv.config.ts`).
 */
export function isMobileSecretEnvFile(name) {
  return name === '.env' || (name.startsWith('.env.') && name.length > '.env.'.length);
}

function isSupportedTextArtifact(name) {
  const lower = name.toLowerCase();
  return (
    MOBILE_SECRET_TEXT_ARTIFACT_EXTENSIONS.has(extname(lower).toLowerCase()) ||
    isMobileSecretEnvFile(lower)
  );
}

/**
 * Bun runs a package script with that package as its current directory. The
 * M1 harness deliberately passes repository-relative roots, so preserve a
 * direct CWD-relative path when it exists and otherwise resolve the same
 * relative path from this script's repository root. Invalid paths retain the
 * original CWD-relative error target instead of silently scanning elsewhere.
 */
export function resolveMobileSecretRoot(
  candidate,
  { cwd = process.cwd(), repositoryRoot = REPOSITORY_ROOT } = {},
) {
  if (isAbsolute(candidate)) return resolve(candidate);

  const fromCwd = resolve(cwd, candidate);
  if (existsSync(fromCwd)) return fromCwd;

  const fromRepositoryRoot = resolve(repositoryRoot, candidate);
  if (existsSync(fromRepositoryRoot)) return fromRepositoryRoot;

  return fromCwd;
}

function relativePath(root, path) {
  return relative(root, path).replaceAll('\\', '/');
}

function isAncestorPath(ancestor, path) {
  const difference = relative(ancestor, path);
  return (
    difference === '' ||
    (difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
  );
}

function commonAncestor(paths) {
  let ancestor = paths[0];
  for (const path of paths.slice(1)) {
    while (!isAncestorPath(ancestor, path)) {
      const parent = dirname(ancestor);
      if (parent === ancestor) return ancestor;
      ancestor = parent;
    }
  }
  return ancestor;
}

function isBinaryContent(bytes) {
  if (bytes.includes(0)) return true;

  let controlBytes = 0;
  for (const byte of bytes) {
    if ((byte >= 1 && byte <= 8) || (byte >= 14 && byte <= 31) || byte === 127) {
      controlBytes += 1;
    }
  }
  if (bytes.length > 0 && controlBytes / bytes.length > 0.01) return true;

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return false;
  } catch {
    return true;
  }
}

function addSkipped(skipped, record) {
  if (skipped.length < MAX_SKIPPED_RECORDS) {
    skipped.push(record);
    return;
  }

  if (skipped.length === MAX_SKIPPED_RECORDS) {
    skipped.push({ path: '<additional paths omitted>', reason: 'record_limit' });
  }
}

function sortByPath(left, right) {
  const pathOrder = left.path.localeCompare(right.path);
  if (pathOrder !== 0) return pathOrder;
  const lineOrder = (left.line ?? 0) - (right.line ?? 0);
  if (lineOrder !== 0) return lineOrder;
  return (left.ruleId ?? left.reason).localeCompare(right.ruleId ?? right.reason);
}

function validateOptions({ roots, exclusions, maxTextBytes }) {
  if (
    !Array.isArray(roots) ||
    roots.some((root) => typeof root !== 'string' || root.length === 0)
  ) {
    throw new TypeError('roots must be an array of non-empty paths');
  }
  if (!Array.isArray(exclusions) || exclusions.some((exclusion) => typeof exclusion !== 'string')) {
    throw new TypeError('exclusions must be an array of directory names');
  }
  if (!Number.isSafeInteger(maxTextBytes) || maxTextBytes < 1) {
    throw new TypeError('maxTextBytes must be a positive safe integer');
  }
}

export async function scanMobileSecretRoots({
  roots,
  exclusions = DEFAULT_EXCLUSIONS,
  maxTextBytes = 2 * 1024 * 1024,
}) {
  validateOptions({ roots, exclusions, maxTextBytes });

  const exclusionNames = new Set(exclusions);
  const findings = [];
  const skipped = [];
  // Oversized supported artifacts are counted independently of the bounded
  // `skipped` diagnostic sample. Once MAX_SKIPPED_RECORDS is reached, addSkipped
  // stops retaining individual records (including max_text_bytes reasons), so a
  // count derived from `skipped` would under-report and let the fail-closed
  // gate pass an unscanned oversized bundle. This counter is the source of
  // truth for the CLI's fail-closed check.
  let oversizedCount = 0;
  // Binary supported artifacts are counted independently for the same reason:
  // a supported extension whose content is binary cannot be scanned, so the
  // fail-closed gate must fire even if the bounded `skipped` sample has already
  // dropped the individual binary_content record.
  let binarySkippedCount = 0;
  const absoluteRoots = [...new Set(roots.map((candidate) => resolveMobileSecretRoot(candidate)))];
  const repositoryBase = commonAncestor(absoluteRoots);

  for (const root of absoluteRoots) {
    const rootStat = await stat(root);
    if (!rootStat.isDirectory()) {
      throw new Error(`Mobile secret scan root is not a directory: ${root}`);
    }

    async function scanDirectory(directory) {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        const path = resolve(directory, entry.name);
        const pathFromRepository = relativePath(repositoryBase, path);

        if (entry.isDirectory()) {
          if (exclusionNames.has(entry.name)) {
            addSkipped(skipped, { path: pathFromRepository, reason: 'excluded_directory' });
            continue;
          }
          await scanDirectory(path);
          continue;
        }

        if (!entry.isFile()) continue;

        if (!isSupportedTextArtifact(entry.name)) {
          addSkipped(skipped, { path: pathFromRepository, reason: 'unsupported_extension' });
          continue;
        }

        const fileStat = await stat(path);
        if (fileStat.size > maxTextBytes) {
          oversizedCount += 1;
          addSkipped(skipped, { path: pathFromRepository, reason: 'max_text_bytes' });
          continue;
        }

        const bytes = await readFile(path);
        if (isBinaryContent(bytes)) {
          binarySkippedCount += 1;
          addSkipped(skipped, { path: pathFromRepository, reason: 'binary_content' });
          continue;
        }

        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        findings.push(
          ...scanMobileSecretText({
            path: pathFromRepository,
            text,
            allowPolicySentinelLiterals: path === MOBILE_SECRET_POLICY_SOURCE_PATH,
          }),
        );
      }
    }

    await scanDirectory(root);
  }

  return {
    findings: findings.sort(sortByPath),
    skipped: skipped.sort(sortByPath),
    oversizedCount,
    binarySkippedCount,
  };
}

class InvalidArgumentsError extends Error {}

function requireArgument(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new InvalidArgumentsError(`${flag} requires a value`);
  }
  return value;
}

function parseMaxTextBytes(value) {
  if (!/^\d+$/u.test(value)) {
    throw new InvalidArgumentsError('--max-bytes must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentsError('--max-bytes must be a positive integer');
  }
  return parsed;
}

function parseArguments(argv) {
  const roots = [];
  let jsonPath;
  let maxTextBytes = 2 * 1024 * 1024;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--root') {
      roots.push(requireArgument(argv, index, flag));
      index += 1;
      continue;
    }
    if (flag === '--json') {
      jsonPath = requireArgument(argv, index, flag);
      index += 1;
      continue;
    }
    if (flag === '--max-bytes') {
      maxTextBytes = parseMaxTextBytes(requireArgument(argv, index, flag));
      index += 1;
      continue;
    }
    throw new InvalidArgumentsError(`Unknown argument: ${flag}`);
  }

  return {
    roots: roots.length > 0 ? roots : [process.cwd()],
    jsonPath,
    maxTextBytes,
  };
}

async function writeJsonReport(path, report) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function runMobileSecretScannerCli(argv = process.argv.slice(2)) {
  try {
    const { roots, jsonPath, maxTextBytes } = parseArguments(argv);
    const report = await scanMobileSecretRoots({ roots, maxTextBytes });

    if (jsonPath) await writeJsonReport(jsonPath, report);

    if (report.findings.length > 0) {
      console.error(
        `Mobile secret findings:\n${report.findings
          .map(({ path, line, ruleId, fingerprint }) =>
            fingerprint
              ? `${path}:${line} ${ruleId} ${fingerprint}`
              : `${path}:${line} ${ruleId}`,
          )
          .join('\n')}`,
      );
      return 4;
    }

    // Fail closed: a supported text artifact that exceeds --max-bytes or
    // contains binary content cannot be scanned, so "No mobile secrets found"
    // would be an unverified claim. The gate must fail rather than silently
    // pass an oversized bundle, source map, or binary file that may embed a
    // credential. Raise --max-bytes only when the oversized file is understood
    // and trusted. Both counts are tracked independently of the bounded
    // `skipped` sample so they stay accurate even after MAX_SKIPPED_RECORDS
    // truncates the diagnostic list.
    if (report.oversizedCount > 0) {
      const listed = report.skipped
        .filter((record) => record.reason === 'max_text_bytes')
        .map(({ path }) => path);
      const listedText =
        listed.length > 0
          ? `\n${listed.join('\n')}`
          : '\n(oversized files were omitted from the skipped-record sample)';
      console.error(
        `Mobile secret scanner could not scan ${report.oversizedCount} supported text artifact(s) larger than ${maxTextBytes} bytes:${listedText}\nRaise --max-bytes only after confirming these files are safe to load.`,
      );
      return 3;
    }

    if (report.binarySkippedCount > 0) {
      const listed = report.skipped
        .filter((record) => record.reason === 'binary_content')
        .map(({ path }) => path);
      const listedText =
        listed.length > 0
          ? `\n${listed.join('\n')}`
          : '\n(binary files were omitted from the skipped-record sample)';
      console.error(
        `Mobile secret scanner could not scan ${report.binarySkippedCount} supported text artifact(s) with binary content:${listedText}\nThese files have a supported extension but cannot be decoded as UTF-8; confirm they are safe before excluding them.`,
      );
      return 3;
    }

    console.log(`No mobile secrets found under ${roots.join(', ')}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof InvalidArgumentsError) {
      console.error(`Invalid mobile secret scanner arguments: ${message}`);
      return 2;
    }
    console.error(`Mobile secret scanner failed: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runMobileSecretScannerCli();
}
