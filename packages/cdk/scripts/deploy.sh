#!/bin/bash

# Deployment script for Vela app to AWS

set -e

echo "🚀 Starting deployment to AWS..."

# Check if required tools are installed
if ! command -v sam &> /dev/null; then
    echo "❌ AWS SAM CLI is not installed. Please install it first:"
    echo "   https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed. Please install it first:"
    echo "   https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

# Build the frontend
echo "📦 Building frontend..."
npm run build

# Build the Lambda function
echo "📦 Building Lambda function..."
npm run lambda:build

# Deploy using SAM
echo "🚀 Deploying to AWS..."
sam deploy --guided

echo "✅ Deployment completed!"
echo ""
echo "Next steps:"
echo "1. Upload your frontend files to the S3 bucket shown in the outputs"
echo "2. Your API will be available at the API Gateway URL shown in the outputs"
echo "3. Your website will be available via the CloudFront distribution URL"
