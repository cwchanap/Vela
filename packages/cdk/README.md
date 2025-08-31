# Vela CDK Infrastructure

AWS CDK infrastructure code for deploying the Vela application and its backend services.

## Structure

- `bin/` - CDK app entry point
- `lib/` - CDK stack definitions
- `lambda/` - Lambda function code
- `worker/` - Cloudflare Worker code
- `scripts/` - Deployment and utility scripts

## Commands

```bash
# Build Lambda functions
npm run build

# Synthesize CloudFormation template
npm run cdk:synth

# Deploy infrastructure
npm run cdk:deploy

# Check differences
npm run cdk:diff

# Destroy infrastructure
npm run cdk:destroy

# Lint code
npm run lint

# Format code
npm run format
```

## Infrastructure Components

- **Lambda Functions**: Backend API endpoints
- **DynamoDB**: Data storage
- **CloudFront**: CDN for static assets
- **S3**: Static file hosting
- **Cloudflare Workers**: Edge computing

## Prerequisites

- AWS CLI configured
- AWS CDK CLI installed (`npm install -g aws-cdk`)
- Appropriate AWS permissions for deploying resources
