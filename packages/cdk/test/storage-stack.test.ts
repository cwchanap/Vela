import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { StorageStack } from '../lib/storage-stack';

describe('StorageStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.FRONTEND_ORIGINS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesizeTemplate() {
    const app = new App();
    const stack = new StorageStack(app, 'TestStorageStack', {
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });

    return { template: Template.fromStack(stack), stack };
  }

  test('creates TTS audio S3 bucket with BLOCK_ALL public access', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('configures CORS with GET and HEAD methods', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedMethods: Match.arrayWith(['GET', 'HEAD']),
          }),
        ]),
      },
    });
  });

  test('includes localhost in CORS origins in non-production', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedOrigins: Match.arrayWith(['http://localhost:9000']),
          }),
        ]),
      },
    });
  });

  test('uses production domain when FRONTEND_ORIGINS is empty in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.FRONTEND_ORIGINS;

    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedOrigins: Match.arrayWith(['https://vela.cwchanap.dev']),
          }),
        ]),
      },
    });
  });

  test('does not include localhost in CORS origins in production with custom origins', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_ORIGINS = 'https://staging.example.com';

    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedOrigins: ['https://staging.example.com'],
          }),
        ]),
      },
    });
  });

  test('bucket is not versioned', () => {
    const { template } = synthesizeTemplate();

    const buckets = template.findResources('AWS::S3::Bucket');
    const bucket = Object.values(buckets)[0];

    expect(bucket!.Properties.VersioningConfiguration).toBeUndefined();
  });

  test('uses custom FRONTEND_ORIGINS from env var', () => {
    process.env.FRONTEND_ORIGINS = 'https://custom.example.com, https://other.example.com';

    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedOrigins: Match.arrayWith([
              'https://custom.example.com',
              'https://other.example.com',
              'http://localhost:9000',
            ]),
          }),
        ]),
      },
    });
  });

  test('exposes ttsAudioBucket as public property', () => {
    const { stack } = synthesizeTemplate();

    expect(stack.ttsAudioBucket).toBeDefined();
  });
});
