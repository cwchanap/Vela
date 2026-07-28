import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';

describe('ApiStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS = 'true';
    process.env.COGNITO_DOMAIN_PREFIX = 'vela-test-auth';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME = 'vela/test-google-oauth-client-secret';
    delete process.env.CORS_ALLOWED_ORIGINS;
    delete process.env.CORS_ALLOWED_EXTENSION_IDS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesizeTemplate(): Template {
    const app = new App();
    const stackEnv = {
      account: '123456789012',
      region: 'us-east-1',
    };
    const auth = new AuthStack(app, 'TestApiAuthStack', { env: stackEnv });
    const database = new DatabaseStack(app, 'TestApiDatabaseStack', { env: stackEnv });
    const storage = new StorageStack(app, 'TestApiStorageStack', { env: stackEnv });
    const api = new ApiStack(app, 'TestApiStack', {
      env: stackEnv,
      auth,
      database,
      storage,
    });

    return Template.fromStack(api);
  }

  test('passes configured browser extension IDs to Lambda and API Gateway CORS', () => {
    process.env.CORS_ALLOWED_EXTENSION_IDS = 'chrome-prod-id, firefox-prod-id';

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CORS_ALLOWED_EXTENSION_IDS: 'chrome-prod-id, firefox-prod-id',
        }),
      },
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({
            ResponseTemplates: Match.objectLike({
              'application/json': Match.stringLikeRegexp('chrome-extension://chrome-prod-id'),
            }),
          }),
        ]),
      }),
    });
  });

  test('includes capacitor://localhost and mobile dev origins in default CORS_ALLOWED_ORIGINS', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CORS_ALLOWED_ORIGINS: Match.stringLikeRegexp('capacitor://localhost'),
        }),
      },
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CORS_ALLOWED_ORIGINS: Match.stringLikeRegexp('http://localhost:9100'),
        }),
      },
    });

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CORS_ALLOWED_ORIGINS: Match.stringLikeRegexp('http://127.0.0.1:9100'),
        }),
      },
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({
            ResponseTemplates: Match.objectLike({
              'application/json': Match.stringLikeRegexp('capacitor://localhost'),
            }),
          }),
        ]),
      }),
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({
            ResponseTemplates: Match.objectLike({
              'application/json': Match.stringLikeRegexp('http://localhost:9100'),
            }),
          }),
        ]),
      }),
    });

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({
            ResponseTemplates: Match.objectLike({
              'application/json': Match.stringLikeRegexp('http://127.0.0.1:9100'),
            }),
          }),
        ]),
      }),
    });
  });

  test('enables Access-Control-Allow-Credentials in CORS preflight', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'OPTIONS',
      Integration: Match.objectLike({
        IntegrationResponses: Match.arrayWith([
          Match.objectLike({
            ResponseParameters: Match.objectLike({
              'method.response.header.Access-Control-Allow-Credentials': "'true'",
            }),
          }),
        ]),
      }),
    });
  });

  test('passes capacitor://localhost through when CORS_ALLOWED_ORIGINS is overridden', () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://staging.example.com,capacitor://localhost';

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CORS_ALLOWED_ORIGINS: 'https://staging.example.com,capacitor://localhost',
        }),
      },
    });
  });

  test('passes distinct web and mobile Cognito client IDs to the Lambda', () => {
    const template = synthesizeTemplate();
    const functions = template.findResources('AWS::Lambda::Function');
    const lambda = Object.values(functions).find(
      (resource) => resource.Properties?.FunctionName === 'vela-api',
    );
    const variables = lambda?.Properties?.Environment?.Variables;
    const webClientId = variables?.COGNITO_CLIENT_ID;
    const mobileClientId = variables?.COGNITO_MOBILE_CLIENT_ID;

    expect(Object.keys(webClientId ?? {})).toEqual(['Fn::ImportValue']);
    expect(Object.keys(mobileClientId ?? {})).toEqual(['Fn::ImportValue']);
    expect(mobileClientId).not.toEqual(webClientId);
  });
});
