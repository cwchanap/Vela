import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { scanMobileSecretText } from '../build/mobile-secret-policy.ts';
import { PRODUCTION_TEXT_ARTIFACT_EXTENSIONS } from './verify-production-diagnostics.mjs';

const DEFAULT_EXCLUSIONS = ['node_modules', 'DerivedData', 'coverage', '.git'];
const MAX_SKIPPED_RECORDS = 1_000;
const MOBILE_SECRET_POLICY_SOURCE_PATH = fileURLToPath(
  new URL('../build/mobile-secret-policy.ts', import.meta.url),
);

export const MOBILE_SECRET_TEXT_ARTIFACT_EXTENSIONS = new Set([
  ...PRODUCTION_TEXT_ARTIFACT_EXTENSIONS,
  '.log',
  '.md',
  '.plist',
  '.pbxproj',
  '.xcconfig',
  '.entitlements',
  '.yaml',
  '.yml',
]);

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
  if (!Array.isArray(roots) || roots.some((root) => typeof root !== 'string' || root.length === 0)) {
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
  const absoluteRoots = [...new Set(roots.map((candidate) => resolve(candidate)))];
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

        if (!MOBILE_SECRET_TEXT_ARTIFACT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
          addSkipped(skipped, { path: pathFromRepository, reason: 'unsupported_extension' });
          continue;
        }

        const fileStat = await stat(path);
        if (fileStat.size > maxTextBytes) {
          addSkipped(skipped, { path: pathFromRepository, reason: 'max_text_bytes' });
          continue;
        }

        const bytes = await readFile(path);
        if (isBinaryContent(bytes)) {
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
          .map(({ path, line, ruleId, fingerprint }) => `${path}:${line} ${ruleId} ${fingerprint}`)
          .join('\n')}`,
      );
      return 4;
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
