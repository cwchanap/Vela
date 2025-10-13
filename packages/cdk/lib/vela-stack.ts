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
  OriginRequestPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin, RestApiOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { UserPool, UserPoolClient, AccountRecovery } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import {
  Certificate,
  CertificateValidation,
  ICertificate,
} from 'aws-cdk-lib/aws-certificatemanager';
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
      userPoolName: `vela-user-pool-${Stack.of(this).account}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: false,
      },
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
      disableOAuth: false,
    });

    // DynamoDB Tables
    const chatHistoryTable = new Table(this, 'VelaChatHistoryTable', {
      tableName: 'vela-chat-history',
      partitionKey: {
        name: 'ThreadId',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'Timestamp',
        type: AttributeType.NUMBER,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
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

    const profilesTable = new Table(this, 'VelaProfilesTable', {
      tableName: 'vela-profiles',
      partitionKey: {
        name: 'user_id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    const vocabularyTable = new Table(this, 'VelaVocabularyTable', {
      tableName: 'vela-vocabulary',
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    const sentencesTable = new Table(this, 'VelaSentencesTable', {
      tableName: 'vela-sentences',
      partitionKey: {
        name: 'id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    const gameSessionsTable = new Table(this, 'VelaGameSessionsTable', {
      tableName: 'vela-game-sessions',
      partitionKey: {
        name: 'user_id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'session_id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    const dailyProgressTable = new Table(this, 'VelaDailyProgressTable', {
      tableName: 'vela-daily-progress',
      partitionKey: {
        name: 'user_id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'date',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    const savedSentencesTable = new Table(this, 'VelaSavedSentencesTable', {
      tableName: 'vela-saved-sentences',
      partitionKey: {
        name: 'user_id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'sentence_id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
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
        PROFILES_TABLE_NAME: profilesTable.tableName,
        VOCABULARY_TABLE_NAME: vocabularyTable.tableName,
        SENTENCES_TABLE_NAME: sentencesTable.tableName,
        GAME_SESSIONS_TABLE_NAME: gameSessionsTable.tableName,
        DAILY_PROGRESS_TABLE_NAME: dailyProgressTable.tableName,
        SAVED_SENTENCES_TABLE_NAME: savedSentencesTable.tableName,
        GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',
        VITE_COGNITO_USER_POOL_ID: userPool.userPoolId,
        VITE_COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        DDB_REGION: Stack.of(this).region,
      },
    });

    // Grant DynamoDB permissions to Lambda
    chatHistoryTable.grantReadWriteData(apiLambda);
    profilesTable.grantReadWriteData(apiLambda);
    vocabularyTable.grantReadWriteData(apiLambda);
    sentencesTable.grantReadWriteData(apiLambda);
    gameSessionsTable.grantReadWriteData(apiLambda);
    dailyProgressTable.grantReadWriteData(apiLambda);
    savedSentencesTable.grantReadWriteData(apiLambda);

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

    // Custom domain configuration
    const defaultDomainName = 'vela.cwchanap.dev';
    const configuredDomain = process.env.DOMAIN_NAME?.trim();
    const domainName =
      configuredDomain && configuredDomain.length > 0 ? configuredDomain : defaultDomainName;

    const certificateArn = process.env.CLOUDFRONT_CERT_ARN || process.env.ACM_CERT_ARN;

    let certificate: ICertificate;
    if (certificateArn) {
      certificate = Certificate.fromCertificateArn(this, 'VelaCertificate', certificateArn);
    } else {
      // Fallback: create a certificate. Ensure your stack region is us-east-1 for CloudFront, and complete DNS validation manually in your DNS provider (Cloudflare).
      certificate = new Certificate(this, 'VelaCertificate', {
        domainName,
        validation: CertificateValidation.fromDns(),
      });
    }

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

    const apiOrigin = new RestApiOrigin(api);

    // CloudFront Distribution with custom domain (new logical ID to force replacement)
    const distribution = new Distribution(this, 'VelaDistributionNew', {
      defaultBehavior: {
        origin: new S3Origin(websiteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: [domainName],
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

    // Ensure API routes are evaluated before default behavior
    distribution.addBehavior('api/*', apiOrigin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: AllowedMethods.ALLOW_ALL,
    });

    distribution.addBehavior('api', apiOrigin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: AllowedMethods.ALLOW_ALL,
    });

    // Deploy website to S3
    new BucketDeployment(this, 'VelaWebsiteDeployment', {
      sources: [Source.asset(path.join(__dirname, '../../../apps/vela/dist/spa'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
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

    new CfnOutput(this, 'DynamoDBChatHistoryTableName', {
      value: chatHistoryTable.tableName,
      description: 'DynamoDB Chat History Table Name',
    });

    new CfnOutput(this, 'DynamoDBProfilesTableName', {
      value: profilesTable.tableName,
      description: 'DynamoDB Profiles Table Name',
    });

    new CfnOutput(this, 'DynamoDBVocabularyTableName', {
      value: vocabularyTable.tableName,
      description: 'DynamoDB Vocabulary Table Name',
    });

    new CfnOutput(this, 'DynamoDBSentencesTableName', {
      value: sentencesTable.tableName,
      description: 'DynamoDB Sentences Table Name',
    });

    new CfnOutput(this, 'DynamoDBGameSessionsTableName', {
      value: gameSessionsTable.tableName,
      description: 'DynamoDB Game Sessions Table Name',
    });

    new CfnOutput(this, 'DynamoDBDailyProgressTableName', {
      value: dailyProgressTable.tableName,
      description: 'DynamoDB Daily Progress Table Name',
    });

    new CfnOutput(this, 'DynamoDBSavedSentencesTableName', {
      value: savedSentencesTable.tableName,
      description: 'DynamoDB Saved Sentences Table Name',
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

    new CfnOutput(this, 'CloudFrontDomain', {
      value: distribution.distributionDomainName,
      description: 'CloudFront domain name - use this for CNAME record in Cloudflare',
    });

    // Environment Variables for Frontend

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
      value: '/api/',
      description: 'Frontend API base path via CloudFront',
    });
  }
}
