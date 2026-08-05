import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadMobileBuildEnv, validateMobileBuildEnv } from './validate-mobile-api-url';

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
 * Normalizes a mobile API URL for comparison, preserving the path. The CDK
 * `MobileApiURL` output is the full `${websiteOrigin}/api/` URL (see
 * `static-web-stack.ts`), and `inject-env.ts` consumes that full URL when
 * generating `.env.production`, so the comparison must respect the path —
 * a same-origin wrong path (e.g. `https://vela.example/wrong` vs
 * `https://vela.example/api/`) is a real misconfiguration that origin-only
 * comparison would false-positive. Only trailing slashes on the pathname are
 * normalized, so `https://x/api/` and `https://x/api` compare equal. Returns
 * undefined when the value is not a valid credential-free http(s) URL with a
 * hostname.
 */
function normalizeMobileApiUrl(value: unknown): string | undefined {
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
    const pathname = url.pathname.replace(/\/+$/u, '') || '/';
    return `${url.origin}${pathname}${url.search}${url.hash}`;
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
 * a key → value map before comparison. `MobileApiURL` is compared by full
 * normalized URL (see `normalizeMobileApiUrl` — the path is preserved so a
 * same-origin wrong path is rejected); the remaining identifiers must match
 * exactly after trimming.
 *
 * The build-time env contract (`validateMobileBuildEnv`) is enforced first,
 * so a missing or malformed env fails before any deployed-state comparison.
 * When a `cdkOutputsPath` is requested but unreadable or unparseable, that
 * error surfaces next (the deployment state is unknowable); the value
 * comparison runs last.
 */
export async function verifyDeployedConfig(options: VerifyOptions): Promise<DeployedConfig> {
  // Use process.env when no explicit override is given so the verifier sees
  // the same Vite precedence the actual build uses: existing process.env
  // values win over .env files. Passing {} would ignore shell/CI overrides,
  // letting the verifier pass against .env.production while the build uses
  // different VITE_* values from the environment.
  const loaded = loadMobileBuildEnv('production', options.mobileRoot, options.env ?? process.env);

  // Enforce the full build-time contract (valid URL, host-only OAuth domain,
  // matching pool region, no whitespace) before comparing against deployed
  // outputs. Without this, malformed-but-present values that match CDK outputs
  // could satisfy closure while failing at app boot.
  validateMobileBuildEnv(loaded);

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

  if (outputs) {
    for (const [field, cdkKey] of Object.entries(CDK_OUTPUT_KEYS)) {
      const expected = outputs[cdkKey];
      const actualValue = (actual as Record<string, unknown>)[field];
      let matches = false;
      if (field === 'mobileApiUrl') {
        const expectedUrl = normalizeMobileApiUrl(expected);
        matches =
          expectedUrl !== undefined && expectedUrl === normalizeMobileApiUrl(actualValue);
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
