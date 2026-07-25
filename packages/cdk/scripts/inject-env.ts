import fs from 'node:fs';
import path from 'node:path';

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

  // Derive the website origin from CFN outputs so a non-production deployment
  // (different VELA_DOMAIN_NAME) generates redirect URLs that match the URIs
  // AuthStack registered in Cognito. Fall back to the CloudFrontDomain output
  // (always emitted) when WebsiteOrigin is absent (older stack without the
  // new output). Env var overrides remain as escape hatches.
  const websiteOrigin =
    outputs.WebsiteOrigin ||
    (outputs.CloudFrontDomain ? `https://${outputs.CloudFrontDomain}` : undefined);
  if (!websiteOrigin) {
    throw new Error(
      'Missing WebsiteOrigin in CloudFormation outputs (and CloudFrontDomain fallback absent). ' +
        'Re-deploy the CDK stack to emit WebsiteOrigin, or set VITE_COGNITO_REDIRECT_SIGN_IN / ' +
        'VITE_COGNITO_REDIRECT_SIGN_OUT / VITE_MOBILE_API_URL env vars to override.',
    );
  }

  // Mobile API URL: derived from the same website origin as the web app's
  // redirect URLs (MobileApiURL CFN output). Falls back to `${websiteOrigin}/api/`
  // when the output is absent (older stack). Env var override as escape hatch.
  const mobileApiUrl =
    process.env.VITE_MOBILE_API_URL || outputs.MobileApiURL || `${websiteOrigin}/api/`;

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
