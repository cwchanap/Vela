import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration, Cors } from 'aws-cdk-lib/aws-apigateway';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { Bucket, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import {
  Distribution,
  ViewerProtocolPolicy,
  CachePolicy,
  AllowedMethods,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin, RestApiOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { UserPool, UserPoolClient, AccountRecovery } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import * as path from 'path';

// CommonJS globals are available in this context
declare const __dirname: string;
declare const process: any;

export class VelaStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Cognito User Pool for Authentication
    const userPool = new UserPool(this, 'VelaUserPool', {
      userPoolName: 'vela-user-pool',
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      // Disable automatic email verification - users will NOT be auto-confirmed
      autoVerify: {
        email: false,
      },
      // Disable email verification requirement for sign up
      signInCaseSensitive: false,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 6,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
    });

    // Apply removal policy explicitly
    userPool.applyRemovalPolicy(RemovalPolicy.DESTROY);

    // Cognito User Pool Client for Web Application
    const userPoolClient = new UserPoolClient(this, 'VelaUserPoolClient', {
      userPool,
      userPoolClientName: 'vela-web-client',
      authFlows: {
        adminUserPassword: true,
        custom: true,
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
      // Explicitly disable email verification for this client
      disableOAuth: false,
    });

    // DynamoDB Table for Chat History
    const chatHistoryTable = new Table(this, 'VelaTable', {
      tableName: 'vela',
      partitionKey: {
        name: 'ThreadId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Timestamp',
        type: AttributeType.NUMBER,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for listing threads by user
    chatHistoryTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: {
        name: 'UserId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Timestamp',
        type: AttributeType.NUMBER,
      },
    });

    // Lambda Function
    const apiLambda = new Function(this, 'VelaApiFunction', {
      functionName: 'vela-api',
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '../dist/lambda')),
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        DYNAMODB_TABLE_NAME: chatHistoryTable.tableName,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
        VITE_COGNITO_USER_POOL_ID: userPool.userPoolId,
        AWS_REGION: Stack.of(this).region,
      },
    });

    // Grant DynamoDB permissions to Lambda
    chatHistoryTable.grantReadWriteData(apiLambda);

    // Grant Cognito permissions to Lambda for admin operations
    apiLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminConfirmSignUp',
          'cognito-idp:AdminGetUser',
          'cognito-idp:ListUsers',
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    // API Gateway
    const api = new RestApi(this, 'VelaApi', {
      restApiName: 'Vela API',
      description: 'API for Vela Japanese Learning App',
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });

    // API Gateway Integration
    const lambdaIntegration = new LambdaIntegration(apiLambda);

    // Add API routes
    const apiResource = api.root.addResource('api');
    apiResource.addProxy({
      defaultIntegration: lambdaIntegration,
      anyMethod: true,
    });

    // SSL Certificate for custom domain
    const certificate = new Certificate(this, 'VelaCertificate', {
      domainName: 'vela.cwchanap.dev',
      validation: CertificateValidation.fromDns(),
    });

    // S3 Bucket for Static Website
    const websiteBucket = new Bucket(this, 'VelaWebBucket', {
      bucketName: `vela-web-${Stack.of(this).account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // CloudFront Distribution with custom domain
    const distribution = new Distribution(this, 'VelaDistribution', {
      defaultBehavior: {
        origin: new S3Origin(websiteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new RestApiOrigin(api),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          allowedMethods: AllowedMethods.ALLOW_ALL,
        },
      },
      domainNames: ['vela.cwchanap.dev'],
      certificate,
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // Deploy website to S3
    new BucketDeployment(this, 'VelaWebsiteDeployment', {
      sources: [Source.asset(path.join(__dirname, '../../../apps/vela/dist/spa'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // DNS Records for custom domain
    // Create hosted zone for the domain
    const hostedZone = new HostedZone(this, 'VelaHostedZone', {
      zoneName: 'cwchanap.dev',
    });

    // Outputs
    new CfnOutput(this, 'WebsiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Website URL',
    });

    new CfnOutput(this, 'ApiURL', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new CfnOutput(this, 'DynamoDBTableName', {
      value: chatHistoryTable.tableName,
      description: 'DynamoDB Table Name',
    });

    new CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    // Cognito Outputs
    new CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new CfnOutput(this, 'CognitoUserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new CfnOutput(this, 'CognitoRegion', {
      value: Stack.of(this).region,
      description: 'AWS Region for Cognito',
    });

    new CfnOutput(this, 'HostedZoneId', {
      value: hostedZone.hostedZoneId,
      description:
        'Hosted Zone ID - check Route 53 console for name servers to update in Cloudflare',
    });

    new CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront domain name - use this for CNAME record in Cloudflare',
    });

    // Environment Variables for Frontend
    new CfnOutput(this, 'VITE_SUPABASE_URL', {
      value: process.env.VITE_SUPABASE_URL || '',
      description: 'Supabase URL for frontend',
    });

    new CfnOutput(this, 'VITE_SUPABASE_ANON_KEY', {
      value: process.env.VITE_SUPABASE_ANON_KEY || '',
      description: 'Supabase Anonymous Key for frontend',
    });

    new CfnOutput(this, 'VITE_COGNITO_USER_POOL_ID', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID for frontend',
    });

    new CfnOutput(this, 'VITE_COGNITO_USER_POOL_CLIENT_ID', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID for frontend',
    });

    new CfnOutput(this, 'VITE_AWS_REGION', {
      value: Stack.of(this).region,
      description: 'AWS Region for frontend',
    });

    new CfnOutput(this, 'VITE_API_URL', {
      value: api.url,
      description: 'API Gateway URL for frontend',
    });
  }
}
