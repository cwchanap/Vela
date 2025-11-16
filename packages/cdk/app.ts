#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VelaStack } from '../lib/vela-stack';

const app = new cdk.App();

new VelaStack(app, 'VelaStack', {
  env: process.env.CDK_DEFAULT_ACCOUNT
    ? {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
      }
    : undefined,
  description: 'Vela Japanese Learning App Infrastructure',
});

app.synth();
