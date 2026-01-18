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
bun run build

# Synthesize CloudFormation template
bun cdk:synth

# Deploy infrastructure
bun cdk:deploy

# Check differences
bun cdk:diff

# Destroy infrastructure
bun cdk:destroy

# Lint code
bun run lint

# Format code
bun run format
```

## Infrastructure Components

- **Lambda Functions**: Backend API endpoints
- **DynamoDB**: Data storage
- **CloudFront**: CDN for static assets
- **S3**: Static file hosting
- **Cloudflare Workers**: Edge computing

## Prerequisites

- AWS CLI configured
- AWS CDK CLI available (`bunx aws-cdk <command>`)
- Appropriate AWS permissions for deploying resources
