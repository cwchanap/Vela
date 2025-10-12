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
pnpm run build

# Synthesize CloudFormation template
pnpm cdk:synth

# Deploy infrastructure
pnpm cdk:deploy

# Check differences
pnpm cdk:diff

# Destroy infrastructure
pnpm cdk:destroy

# Lint code
pnpm run lint

# Format code
pnpm run format
```

## Infrastructure Components

- **Lambda Functions**: Backend API endpoints
- **DynamoDB**: Data storage
- **CloudFront**: CDN for static assets
- **S3**: Static file hosting
- **Cloudflare Workers**: Edge computing

## Prerequisites

- AWS CLI configured
- AWS CDK CLI available (`pnpm dlx aws-cdk <command>`)
- Appropriate AWS permissions for deploying resources
