import fs from 'node:fs';
import path from 'node:path';

type OutputEntry = {
  OutputKey?: string;
  OutputValue?: unknown;
};

type OutputMap = Record<string, string>;

function loadOutputs(outputsPath: string): OutputMap {
  if (!fs.existsSync(outputsPath)) {
    throw new Error(`CloudFormation outputs file not found at ${outputsPath}`);
  }

  const raw = fs.readFileSync(outputsPath, 'utf8');
  const data: OutputEntry[] = JSON.parse(raw);

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

  const envVars = {
    VITE_COGNITO_USER_POOL_ID: outputs.VITE_COGNITO_USER_POOL_ID,
    VITE_COGNITO_USER_POOL_CLIENT_ID: outputs.VITE_COGNITO_USER_POOL_CLIENT_ID,
    VITE_AWS_REGION:
      process.env.VITE_AWS_REGION ||
      outputs.VITE_AWS_REGION ||
      process.env.AWS_REGION ||
      'us-east-1',
    VITE_API_URL: process.env.VITE_API_URL || outputs.VITE_API_URL || '/api/',
  } as const;

  if (!envVars.VITE_COGNITO_USER_POOL_ID) {
    throw new Error('Missing VITE_COGNITO_USER_POOL_ID in CloudFormation outputs');
  }

  if (!envVars.VITE_COGNITO_USER_POOL_CLIENT_ID) {
    throw new Error('Missing VITE_COGNITO_USER_POOL_CLIENT_ID in CloudFormation outputs');
  }

  const repoRoot = path.resolve(process.cwd(), '..', '..');
  const envFilePath = path.join(repoRoot, 'apps', 'vela', '.env.production');

  const lines = Object.entries(envVars).map(([key, value]) => `${key}=${value}`);
  const content = `${lines.join('\n')}\n`;

  fs.writeFileSync(envFilePath, content, 'utf8');
  console.log(`Wrote environment variables to ${envFilePath}`);
}

main();
