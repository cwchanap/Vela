#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from './lib/auth-stack';
import { DatabaseStack } from './lib/database-stack';
import { StorageStack } from './lib/storage-stack';
import { ApiStack } from './lib/api-stack';
import { StaticWebStack } from './lib/static-web-stack';

const app = new cdk.App();

const env = process.env.CDK_DEFAULT_ACCOUNT
  ? {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
    }
  : undefined;

const authStack = new AuthStack(app, 'AuthStack', {
  env,
  description: 'Vela authentication (Cognito) infrastructure',
});

const databaseStack = new DatabaseStack(app, 'DatabaseStack', {
  env,
  description: 'Vela database infrastructure (DynamoDB, Aurora, VPC)',
});

const storageStack = new StorageStack(app, 'StorageStack', {
  env,
  description: 'Vela storage infrastructure (TTS audio S3 and related buckets)',
});

const apiStack = new ApiStack(app, 'ApiStack', {
  env,
  description: 'Vela API infrastructure (Lambda, API Gateway)',
  auth: authStack,
  database: databaseStack,
  storage: storageStack,
});

new StaticWebStack(app, 'VelaStack', {
  env,
  description: 'Vela static web infrastructure (CloudFront, S3, frontend config)',
  auth: authStack,
  database: databaseStack,
  storage: storageStack,
  api: apiStack,
});

app.synth();
