import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyDeployedConfig } from './verify-deployed-config';

describe('verifyDeployedConfig', () => {
  it('passes when .env.production identifiers match cdk-outputs.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vela-cfg-'));
    try {
      await writeFile(
        join(dir, '.env.production'),
        [
          'VITE_MOBILE_API_URL=https://vela.example/api/',
          'VITE_COGNITO_USER_POOL_ID=us-east-1_POOL',
          'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=abc123',
          'VITE_COGNITO_OAUTH_DOMAIN=auth.example',
          'VITE_AWS_REGION=us-east-1',
        ].join('\n'),
      );
      await writeFile(
        join(dir, 'cdk-outputs.json'),
        JSON.stringify({
          MobileApiURL: 'https://vela.example/api/',
          CognitoUserPoolId: 'us-east-1_POOL',
          CognitoMobileUserPoolClientId: 'abc123',
          CognitoOAuthDomain: 'auth.example',
          CognitoRegion: 'us-east-1',
        }),
      );
      const result = await verifyDeployedConfig({ mobileRoot: dir, cdkOutputsPath: join(dir, 'cdk-outputs.json') });
      expect(result.cognitoUserPoolId).toBe('us-east-1_POOL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws on a user-pool-id mismatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vela-cfg-'));
    try {
      await writeFile(join(dir, '.env.production'),
        'VITE_COGNITO_USER_POOL_ID=us-east-1_POOL\nVITE_MOBILE_API_URL=https://vela.example/api/\nVITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=abc\nVITE_COGNITO_OAUTH_DOMAIN=auth.example\nVITE_AWS_REGION=us-east-1\n');
      await writeFile(join(dir, 'cdk-outputs.json'),
        JSON.stringify({ CognitoUserPoolId: 'us-east-1_DIFFERENT', MobileApiURL: 'https://vela.example/api/', CognitoMobileUserPoolClientId: 'abc', CognitoOAuthDomain: 'auth.example', CognitoRegion: 'us-east-1' }));
      await expect(verifyDeployedConfig({ mobileRoot: dir, cdkOutputsPath: join(dir, 'cdk-outputs.json') }))
        .rejects.toThrow(/CognitoUserPoolId/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when cdk-outputs.json is missing but requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vela-cfg-'));
    try {
      await writeFile(join(dir, '.env.production'), 'VITE_AWS_REGION=us-east-1\n');
      await expect(verifyDeployedConfig({ mobileRoot: dir, cdkOutputsPath: join(dir, 'missing.json') }))
        .rejects.toThrow(/cdk-outputs/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
