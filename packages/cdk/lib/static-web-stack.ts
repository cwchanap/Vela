import { Stack, StackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
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
import {
  Certificate,
  CertificateValidation,
  ICertificate,
} from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import * as path from 'path';
import { AuthStack } from './auth-stack';
import { DatabaseStack } from './database-stack';
import { StorageStack } from './storage-stack';
import { ApiStack } from './api-stack';

declare const __dirname: string;
declare const process: any;

export interface StaticWebStackProps extends StackProps {
  auth: AuthStack;
  database: DatabaseStack;
  storage: StorageStack;
  api: ApiStack;
}

export class StaticWebStack extends Stack {
  constructor(scope: Construct, id: string, props: StaticWebStackProps) {
    super(scope, id, props);

    const { auth, database, api } = props;

    const configuredDomain = process.env.DOMAIN_NAME?.trim();
    const domainName =
      configuredDomain && configuredDomain.length > 0 ? configuredDomain : undefined;

    const certificateArn = process.env.CLOUDFRONT_CERT_ARN || process.env.ACM_CERT_ARN;

    let certificate: ICertificate | undefined;
    if (domainName) {
      if (certificateArn) {
        certificate = Certificate.fromCertificateArn(this, 'VelaCertificate', certificateArn);
      } else {
        certificate = new Certificate(this, 'VelaCertificate', {
          domainName,
          validation: CertificateValidation.fromDns(),
        });
      }
    }

    const websiteBucket = new Bucket(this, 'VelaWebBucket', {
      bucketName: `vela-web-${Stack.of(this).account}`,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ACLS,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    const apiOrigin = new RestApiOrigin(api.api);

    const distribution = new Distribution(this, 'VelaDistributionNew', {
      defaultBehavior: {
        origin: new S3Origin(websiteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
      ...(domainName && certificate
        ? {
            domainNames: [domainName],
            certificate,
          }
        : {}),
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

    new BucketDeployment(this, 'VelaWebsiteDeployment', {
      sources: [Source.asset(path.join(__dirname, '../../../apps/vela/dist/spa'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    new CfnOutput(this, 'WebsiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'Website URL',
    });

    new CfnOutput(this, 'ApiURL', {
      value: api.api.url,
      description: 'API Gateway URL',
    });

    new CfnOutput(this, 'DynamoDBChatHistoryTableName', {
      value: database.chatHistoryTable.tableName,
      description: 'DynamoDB Chat History Table Name',
    });

    new CfnOutput(this, 'DynamoDBProfilesTableName', {
      value: database.profilesTable.tableName,
      description: 'DynamoDB Profiles Table Name',
    });

    new CfnOutput(this, 'DynamoDBVocabularyTableName', {
      value: database.vocabularyTable.tableName,
      description: 'DynamoDB Vocabulary Table Name',
    });

    new CfnOutput(this, 'DynamoDBSentencesTableName', {
      value: database.sentencesTable.tableName,
      description: 'DynamoDB Sentences Table Name',
    });

    new CfnOutput(this, 'DynamoDBGameSessionsTableName', {
      value: database.gameSessionsTable.tableName,
      description: 'DynamoDB Game Sessions Table Name',
    });

    new CfnOutput(this, 'DynamoDBDailyProgressTableName', {
      value: database.dailyProgressTable.tableName,
      description: 'DynamoDB Daily Progress Table Name',
    });

    new CfnOutput(this, 'DynamoDBSavedSentencesTableName', {
      value: database.savedSentencesTable.tableName,
      description: 'DynamoDB Saved Sentences Table Name',
    });

    new CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new CfnOutput(this, 'CognitoUserPoolId', {
      value: auth.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new CfnOutput(this, 'CognitoUserPoolClientId', {
      value: auth.userPoolClient.userPoolClientId,
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

    new CfnOutput(this, 'VITE_COGNITO_USER_POOL_ID', {
      value: auth.userPool.userPoolId,
      description: 'Cognito User Pool ID for frontend',
    });

    new CfnOutput(this, 'VITE_COGNITO_USER_POOL_CLIENT_ID', {
      value: auth.userPoolClient.userPoolClientId,
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

    const ttsAudioBucketName = `vela-tts-audio-${Stack.of(this).account}`;

    new CfnOutput(this, 'TTSAudioBucketName', {
      value: ttsAudioBucketName,
      description: 'S3 bucket for TTS audio files',
    });

    new CfnOutput(this, 'AuroraClusterArn', {
      value: database.dbCluster.clusterArn,
      description: 'Aurora Serverless v2 cluster ARN',
    });

    new CfnOutput(this, 'AuroraSecretArn', {
      value: database.dbCredentials.secretArn,
      description: 'Aurora database credentials secret ARN',
    });

    new CfnOutput(this, 'AuroraClusterEndpoint', {
      value: database.dbCluster.clusterEndpoint.hostname,
      description: 'Aurora cluster endpoint',
    });
  }
}
