import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEBSITE_DOMAIN } from '../lib/constants';

type OutputEntry = {
  OutputKey?: string;
  OutputValue?: unknown;
};

type OutputMap = Record<string, string>;

function loadOutputs(outputsPath: string): OutputMap | null {
  if (!fs.existsSync(outputsPath)) {
    return null;
  }

  const raw = fs.readFileSync(outputsPath, 'utf8');
  let data: OutputEntry[];
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse CloudFormation outputs JSON at ${outputsPath}: ${message}`);
  }

  if (!Array.isArray(data)) {
    throw new Error('Expected CloudFormation outputs JSON to be an array');
  }

  const map: OutputMap = {};

  for (const item of data) {
    if (item && item.OutputKey && Object.prototype.hasOwnProperty.call(item, 'OutputValue')) {
      map[item.OutputKey] = String(item.OutputValue ?? '');
    }
  }

  return map;
}

// Must match the DEFAULT_COGNITO_DOMAIN_PREFIX in AuthStack
const DEFAULT_COGNITO_DOMAIN_PREFIX = 'vela-cwchanap-auth';

// DEFAULT_WEBSITE_DOMAIN is imported from ../lib/constants so this script and
// the CDK stacks share a single source of truth. Used as the fallback for the
// website origin when WebsiteOrigin is absent (older stack deployed before
// this output existed) AND VELA_DOMAIN_NAME is unset. AuthStack registers
// Cognito callback/logout URLs from `VELA_DOMAIN_NAME || DEFAULT_WEBSITE_DOMAIN`,
// so the SPA's redirect URLs must be derived from the same expression — NOT
// from CloudFrontDomain, which Cognito does not have registered and would
// break OAuth on the first deployment of the multi-env refactor.

function main(): void {
  // cdk-outputs.json is written in the @vela/cdk package root
  const outputsPath = path.resolve(process.cwd(), 'cdk-outputs.json');
  const outputs = loadOutputs(outputsPath);

  if (outputs === null) {
    console.log(
      'No CloudFormation outputs found (stack not yet deployed). Skipping .env.production generation.',
    );
    return;
  }

  const awsRegion =
    process.env.VITE_AWS_REGION || outputs.CognitoRegion || process.env.AWS_REGION || 'us-east-1';
  const cognitoDomainPrefix = process.env.COGNITO_DOMAIN_PREFIX || DEFAULT_COGNITO_DOMAIN_PREFIX;
  const cognitoOAuthDomain =
    outputs.CognitoOAuthDomain || `${cognitoDomainPrefix}.auth.${awsRegion}.amazoncognito.com`;

  // An explicitly configured VELA_DOMAIN_NAME describes the stack this run is
  // about to deploy — it must take precedence over WebsiteOrigin/MobileApiURL,
  // which are outputs from the *currently* deployed stack. The deploy workflow
  // exports outputs, injects env, builds the SPA/mobile bundle, and only then
  // runs `cdk deploy`. Giving outputs precedence over VELA_DOMAIN_NAME would
  // build the frontend against the old domain while AuthStack registers
  // Cognito callbacks for the new one — the deployed bundle and Cognito would
  // disagree. Empty string is treated as unset (GitHub Actions unset-var
  // semantics), so configuredOrigin is undefined and we fall through to
  // outputs, then DEFAULT_WEBSITE_DOMAIN — matching AuthStack's expression
  // (`VELA_DOMAIN_NAME || DEFAULT_WEBSITE_DOMAIN`) when nothing is configured.
  // CloudFrontDomain is intentionally NOT used as a fallback: AuthStack
  // registers the custom domain, not the CloudFront domain, so a CloudFront-
  // derived callback URL would be rejected by Cognito on the first deployment
  // of the multi-env refactor.
  const configuredOrigin = process.env.VELA_DOMAIN_NAME
    ? `https://${process.env.VELA_DOMAIN_NAME}`
    : undefined;

  const websiteOrigin =
    configuredOrigin || outputs.WebsiteOrigin || `https://${DEFAULT_WEBSITE_DOMAIN}`;

  // Mobile API URL: derived from the same website origin as the web app's
  // redirect URLs (MobileApiURL CFN output). An explicit VELA_DOMAIN_NAME
  // overrides the stale output for the same reason as websiteOrigin above.
  // VITE_MOBILE_API_URL remains the top-priority escape hatch. Falls back to
  // `${websiteOrigin}/api/` when both configuredOrigin and MobileApiURL are
  // absent (older stack).
  const mobileApiUrl =
    process.env.VITE_MOBILE_API_URL ||
    (configuredOrigin ? `${configuredOrigin}/api/` : undefined) ||
    outputs.MobileApiURL ||
    `${websiteOrigin}/api/`;

  const envVars = {
    VITE_COGNITO_USER_POOL_ID: outputs.CognitoUserPoolId,
    VITE_COGNITO_USER_POOL_CLIENT_ID: outputs.CognitoUserPoolClientId,
    VITE_COGNITO_OAUTH_DOMAIN: cognitoOAuthDomain,
    VITE_COGNITO_REDIRECT_SIGN_IN:
      process.env.VITE_COGNITO_REDIRECT_SIGN_IN || `${websiteOrigin}/auth/callback`,
    VITE_COGNITO_REDIRECT_SIGN_OUT:
      process.env.VITE_COGNITO_REDIRECT_SIGN_OUT || `${websiteOrigin}/auth/login`,
    VITE_AWS_REGION: awsRegion,
    VITE_API_URL: '/api/',
  } as const;

  if (!envVars.VITE_COGNITO_USER_POOL_ID) {
    throw new Error('Missing CognitoUserPoolId in CloudFormation outputs');
  }

  if (!envVars.VITE_COGNITO_USER_POOL_CLIENT_ID) {
    throw new Error('Missing CognitoUserPoolClientId in CloudFormation outputs');
  }

  if (!envVars.VITE_COGNITO_OAUTH_DOMAIN) {
    throw new Error(
      'Missing CognitoOAuthDomain in CloudFormation outputs and COGNITO_DOMAIN_PREFIX is not set',
    );
  }

  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const envFilePath = path.join(repoRoot, 'apps', 'vela', '.env.production');
  const envDir = path.dirname(envFilePath);
  fs.mkdirSync(envDir, { recursive: true });

  const lines = Object.entries(envVars).map(([key, value]) => `${key}=${value}`);
  const content = `${lines.join('\n')}\n`;

  try {
    fs.writeFileSync(envFilePath, content, 'utf8');
    console.log(`Wrote environment variables to ${envFilePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write environment variables to ${envFilePath}: ${message}`);
  }

  // Native builds cannot use the relative '/api/' path the web app relies on
  // (CloudFront-served SPA), so apps/vela-mobile/.env.production is generated
  // with an absolute API endpoint that the Capacitor app calls directly.
  // mobileApiUrl is derived from the MobileApiURL CFN output (or WebsiteOrigin)
  // above, so a non-production deployment routes mobile traffic to its own
  // backend instead of production.
  const mobileEnvFilePath = path.join(repoRoot, 'apps', 'vela-mobile', '.env.production');
  const mobileEnvDir = path.dirname(mobileEnvFilePath);
  fs.mkdirSync(mobileEnvDir, { recursive: true });

  const mobileLines = [`VITE_MOBILE_API_URL=${mobileApiUrl}`];
  const mobileContent = `${mobileLines.join('\n')}\n`;

  try {
    fs.writeFileSync(mobileEnvFilePath, mobileContent, 'utf8');
    console.log(`Wrote environment variables to ${mobileEnvFilePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write environment variables to ${mobileEnvFilePath}: ${message}`);
  }
}

main();
