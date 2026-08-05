import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

type OutputEntry = {
  OutputKey?: string;
  OutputValue?: unknown;
};

/**
 * Reduce the CloudFormation-exports array that `cdk deploy` writes to
 * cdk-outputs.json (entries of `{ OutputKey, OutputValue, ... }`) to a
 * key → value map. Same proven pattern as `packages/cdk/scripts/inject-env.ts`
 * `loadOutputs`, inlined here to avoid a cross-package import.
 */
function loadOutputs(outputsPath: string, raw: string): Record<string, string> {
  let data: OutputEntry[];
  try {
    data = JSON.parse(raw) as OutputEntry[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse cdk-outputs.json at ${outputsPath}: ${message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error(
      `Expected cdk-outputs.json at ${outputsPath} to be an array of CloudFormation outputs`,
    );
  }

  const map: Record<string, string> = {};
  for (const item of data) {
    if (item && item.OutputKey && Object.prototype.hasOwnProperty.call(item, 'OutputValue')) {
      map[item.OutputKey] = String(item.OutputValue ?? '');
    }
  }
  return map;
}

/**
 * Normalizes a mobile API identifier to its origin only (protocol + host),
 * stripping any path such as `/api/`. Mirrors the harness's
 * `normalizeMobileApiOrigin` (m1-foundation-harness.ts): `inject-env.ts`
 * derives `VITE_MOBILE_API_URL` as `${origin}/api/` while the CDK
 * `MobileApiURL` output may be the bare origin, so raw string equality would
 * false-positive. Returns undefined when the value is not a valid
 * credential-free http(s) URL with a hostname.
 */
function normalizeMobileApiOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.origin;
  } catch {
    return undefined;
  }
}

/**
 * Validates that the mobile build env's public Cognito identifiers match the
 * deployed CDK outputs. This is the HPA-210 closure criterion, exposed as the
 * standalone `bun run verify:deployed-config` command.
 *
 * `cdk-outputs.json` holds the CloudFormation-exports array; it is reduced to
 * a key → value map before comparison. `MobileApiURL` is compared by origin
 * only (see `normalizeMobileApiOrigin`); the remaining identifiers must match
 * exactly after trimming.
 *
 * When a `cdkOutputsPath` is requested but unreadable or unparseable, that
 * error surfaces first (the deployment state is unknowable); env presence is
 * validated afterwards, before any value comparison.
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

  let outputs: Record<string, string> | undefined;
  if (options.cdkOutputsPath) {
    let raw: string;
    try {
      raw = await readFile(options.cdkOutputsPath, 'utf8');
    } catch {
      throw new Error(`Unable to read cdk-outputs.json at ${options.cdkOutputsPath}`);
    }
    outputs = loadOutputs(options.cdkOutputsPath, raw);
  }

  for (const [key, value] of Object.entries(actual)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing mobile build identifier: ${key}`);
    }
  }

  if (outputs) {
    for (const [field, cdkKey] of Object.entries(CDK_OUTPUT_KEYS)) {
      const expected = outputs[cdkKey];
      const actualValue = (actual as Record<string, unknown>)[field];
      let matches = false;
      if (field === 'mobileApiUrl') {
        const expectedOrigin = normalizeMobileApiOrigin(expected);
        matches =
          expectedOrigin !== undefined && expectedOrigin === normalizeMobileApiOrigin(actualValue);
      } else {
        matches =
          typeof expected === 'string' &&
          typeof actualValue === 'string' &&
          actualValue.trim() === expected.trim();
      }
      if (!matches) {
        throw new Error(`Deployed config mismatch for ${cdkKey}: env does not match cdk-outputs.json`);
      }
    }
  }
  return actual;
}

/**
 * CLI entry, exported for direct unit testing (no subprocess needed).
 *
 * @param argv Arguments after the script path (e.g. `['--cdk-outputs', '...']`).
 * @param mobileRoot Optional override of the mobile root directory; defaults
 *   to the package dir derived from the module location (repo convention, cf.
 *   scripts/verify-m1-foundation.mjs) rather than process.cwd(), which is the
 *   package dir when run via `bun run verify:deployed-config`.
 *
 * Argument parsing is STRICT: the only supported flag is a single
 * `--cdk-outputs <path>`. Any unknown flag (including a typo such as
 * `--cdk-output`), a duplicate `--cdk-outputs`, or a missing/empty value is a
 * usage error (exit 2) — silently accepting unknown arguments would downgrade
 * verification to presence-only and could false-positive the HPA-210 closure
 * gate. Exit contract: 0 consistent / 1 mismatch-or-error / 2 usage.
 */
export async function runCli(
  argv: string[],
  mobileRoot = fileURLToPath(new URL('..', import.meta.url)),
): Promise<number> {
  let cdkOutputsPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== '--cdk-outputs') {
      console.error(`Unknown argument: ${arg}`);
      console.error('Usage: verify:deployed-config [--cdk-outputs <path>]');
      return 2;
    }
    if (cdkOutputsPath !== undefined) {
      console.error('--cdk-outputs may only be specified once');
      return 2;
    }
    const value = argv[i + 1];
    if (value === undefined || value === '' || value.startsWith('--')) {
      console.error('--cdk-outputs requires a path');
      return 2;
    }
    cdkOutputsPath = value;
    i += 1;
  }
  try {
    const options: VerifyOptions = { mobileRoot };
    if (cdkOutputsPath) options.cdkOutputsPath = cdkOutputsPath;
    const result = await verifyDeployedConfig(options);
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
