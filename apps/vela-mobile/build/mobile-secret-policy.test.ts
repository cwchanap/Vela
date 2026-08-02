import { describe, expect, it } from 'vitest';
import {
  PUBLIC_CONFIGURATION_KEYS,
  scanMobileSecretText,
} from './mobile-secret-policy';

describe('scanMobileSecretText', () => {
  it('finds a bearer credential without retaining its raw value', () => {
    const findings = scanMobileSecretText({
      path: 'captured.log',
      text: 'Authorization: Bearer SECRET-id-token',
    });

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'bearer_value',
        path: 'captured.log',
        line: 1,
        valueClass: 'authorization_bearer',
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain('SECRET-id-token');
  });

  it('allows public mobile configuration identifiers', () => {
    expect(PUBLIC_CONFIGURATION_KEYS).toEqual(
      new Set([
        'VITE_MOBILE_API_URL',
        'VITE_COGNITO_USER_POOL_ID',
        'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
        'VITE_COGNITO_OAUTH_DOMAIN',
        'VITE_AWS_REGION',
      ]),
    );
    expect(
      scanMobileSecretText({
        path: 'manifest.json',
        text: JSON.stringify({
          VITE_COGNITO_USER_POOL_ID: 'us-east-1_public',
          VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'public-client-id',
        }),
      }),
    ).toEqual([]);
  });

  it('finds a full presigned URL but allows an origin-only URL', () => {
    const presignedUrl =
      'https://bucket.example.invalid/audio.mp3?X-Amz-Credential=secret&X-Amz-Signature=secret';

    expect(
      scanMobileSecretText({
        path: 'audio.log',
        text: presignedUrl,
      }),
    ).toHaveLength(1);

    expect(
      scanMobileSecretText({
        path: 'manifest.json',
        text: 'https://api.example.test/api/',
      }),
    ).toEqual([]);
  });

  it('finds a JWT-shaped value without retaining it', () => {
    const token = [
      'eyJhbGciOiJIUzI1NiJ9',
      'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      'signature123456',
    ].join('.');
    const findings = scanMobileSecretText({ path: 'tokens.log', text: `token=${token}` });

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'jwt_value',
        path: 'tokens.log',
        line: 1,
        valueClass: 'jwt',
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain(token);
  });

  it('finds a private-key header without retaining it', () => {
    const privateKeyHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    const findings = scanMobileSecretText({ path: 'id.pem', text: privateKeyHeader });

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'private_key',
        path: 'id.pem',
        line: 1,
        valueClass: 'private_key_header',
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain(privateKeyHeader);
  });

  it('finds an AWS secret access key assignment without retaining it', () => {
    const secret = 'A'.repeat(40);
    const findings = scanMobileSecretText({
      path: '.env',
      text: `AWS_SECRET_ACCESS_KEY=${secret}`,
    });

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'aws_secret',
        path: '.env',
        line: 1,
        valueClass: 'aws_secret_access_key',
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it('finds a provider API key assignment without retaining it', () => {
    const providerKey = ['sk', 'live', 'abcdefghijklmno'].join('-');
    const findings = scanMobileSecretText({
      path: '.env',
      text: `OPENAI_API_KEY=${providerKey}`,
    });

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'provider_key',
        path: '.env',
        line: 1,
        valueClass: 'provider_api_key',
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain(providerKey);
  });

  it('reports the source line for each finding', () => {
    const findings = scanMobileSecretText({
      path: 'captured.log',
      text: ['before', 'Authorization: Bearer SECRET-id-token', 'between', 'SECRET-callback-code'].join(
        '\n',
      ),
    });

    expect(findings.map(({ ruleId, line }) => ({ ruleId, line }))).toEqual([
      { ruleId: 'bearer_value', line: 2 },
      { ruleId: 'secret_sentinel', line: 4 },
    ]);
  });

  it('finds a known sentinel outside a more specific credential match', () => {
    const findings = scanMobileSecretText({
      path: 'captured.log',
      text: 'The callback contained SECRET-callback-code.',
    });

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'secret_sentinel',
        valueClass: 'known_secret_sentinel',
      }),
    ]);
    expect(JSON.stringify(findings)).not.toContain('SECRET-callback-code');
  });

  it('does not classify ordinary auth labels and public origins as secrets', () => {
    expect(
      scanMobileSecretText({
        path: 'manifest.json',
        text: [
          'Authorization: Basic public-client-id',
          'The API key label is public documentation.',
          'https://api.example.test/api/',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('does not classify JavaScript template placeholders as credential values', () => {
    expect(
      scanMobileSecretText({
        path: 'scanner.mjs',
        text: ['Authorization: Bearer ${accessToken}', 'OPENAI_API_KEY=${providerKey}'].join('\n'),
      }),
    ).toEqual([]);
  });
});
