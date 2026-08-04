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

/**
 * Validates that the mobile build env's public Cognito identifiers match the
 * deployed CDK outputs. This is the HPA-210 closure criterion previously
 * carried by the manifest subsystem's --require-deployed-config check.
 *
 * When a `cdkOutputsPath` is requested but unreadable, that error surfaces
 * first (the deployment state is unknowable); env presence is validated
 * afterwards, before any value comparison.
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

  let outputs: Record<string, unknown> | undefined;
  if (options.cdkOutputsPath) {
    let raw: string;
    try {
      raw = await readFile(options.cdkOutputsPath, 'utf8');
    } catch {
      throw new Error(`Unable to read cdk-outputs.json at ${options.cdkOutputsPath}`);
    }
    outputs = JSON.parse(raw) as Record<string, unknown>;
  }

  for (const [key, value] of Object.entries(actual)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Missing mobile build identifier: ${key}`);
    }
  }

  if (outputs) {
    for (const [field, cdkKey] of Object.entries(CDK_OUTPUT_KEYS)) {
      const expected = outputs[cdkKey];
      if (typeof expected !== 'string' || expected !== (actual as Record<string, unknown>)[field]) {
        throw new Error(`Deployed config mismatch for ${cdkKey}: env does not match cdk-outputs.json`);
      }
    }
  }
  return actual;
}

async function runCli(argv: string[]): Promise<number> {
  // Derive the mobile root from the module location (repo convention, cf.
  // scripts/verify-m1-foundation.mjs) rather than process.cwd(), which is the
  // package dir when run via `bun run verify:deployed-config`.
  const mobileRoot = fileURLToPath(new URL('..', import.meta.url));
  const cdkIdx = argv.indexOf('--cdk-outputs');
  const cdkOutputsPath = cdkIdx !== -1 ? argv[cdkIdx + 1] : undefined;
  if (cdkIdx !== -1 && !cdkOutputsPath) {
    console.error('--cdk-outputs requires a path');
    return 2;
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
