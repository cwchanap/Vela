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
  const cognitoDomainPrefix = process.env.COGNITO_DOMAIN_PREFIX;
  const cognitoOAuthDomain =
    outputs.CognitoOAuthDomain ||
    (cognitoDomainPrefix
      ? `${cognitoDomainPrefix}.auth.${awsRegion}.amazoncognito.com`
      : undefined);

  const envVars = {
    VITE_COGNITO_USER_POOL_ID: outputs.CognitoUserPoolId,
    VITE_COGNITO_USER_POOL_CLIENT_ID: outputs.CognitoUserPoolClientId,
    VITE_COGNITO_OAUTH_DOMAIN: cognitoOAuthDomain,
    VITE_COGNITO_REDIRECT_SIGN_IN:
      process.env.VITE_COGNITO_REDIRECT_SIGN_IN || 'https://vela.cwchanap.dev/auth/callback',
    VITE_COGNITO_REDIRECT_SIGN_OUT:
      process.env.VITE_COGNITO_REDIRECT_SIGN_OUT || 'https://vela.cwchanap.dev/auth/login',
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
}

main();
