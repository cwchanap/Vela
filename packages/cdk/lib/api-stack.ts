import { Stack, StackProps, Duration } from 'aws-cdk-lib';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { RestApi, LambdaIntegration, Cors } from 'aws-cdk-lib/aws-apigateway';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';
import { Construct } from 'constructs';
import { AuthStack } from './auth-stack';
import { DatabaseStack } from './database-stack';
import { StorageStack } from './storage-stack';
import { getTtsAudioBucketName } from './naming';

declare const __dirname: string;
declare const process: any;

export interface ApiStackProps extends StackProps {
  auth: AuthStack;
  database: DatabaseStack;
  storage: StorageStack;
}

export class ApiStack extends Stack {
  public readonly api: RestApi;
  public readonly apiLambda: Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { auth, database } = props;

    const ttsAudioBucketName = getTtsAudioBucketName(this);

    // Dedicated security group for the API Lambda so ApiStack no longer imports DatabaseStack's SG.
    const apiSecurityGroup = new ec2.SecurityGroup(this, 'VelaApiSecurityGroup', {
      vpc: database.vpc,
      description: 'Security group for Vela API Lambda to access Aurora DSQL via VPC networking',
      allowAllOutbound: true,
    });

    const apiLambda = new Function(this, 'VelaApiFunction', {
      functionName: 'vela-api',
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromAsset(path.join(__dirname, '../dist/lambda')),
      timeout: Duration.seconds(60),
      memorySize: 1024,
      vpc: database.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [apiSecurityGroup],
      environment: {
        DYNAMODB_TABLE_NAME: database.chatHistoryTable.tableName,
        PROFILES_TABLE_NAME: database.profilesTable.tableName,
        VOCABULARY_TABLE_NAME: database.vocabularyTable.tableName,
        SENTENCES_TABLE_NAME: database.sentencesTable.tableName,
        GAME_SESSIONS_TABLE_NAME: database.gameSessionsTable.tableName,
        DAILY_PROGRESS_TABLE_NAME: database.dailyProgressTable.tableName,
        SAVED_SENTENCES_TABLE_NAME: database.savedSentencesTable.tableName,
        TTS_SETTINGS_TABLE_NAME: database.ttsSettingsTable.tableName,
        TTS_AUDIO_BUCKET_NAME: ttsAudioBucketName,
        AURORA_DB_CLUSTER_ARN: database.dbClusterArn,
        AURORA_DB_ENDPOINT: database.dbClusterEndpoint,
        AURORA_DB_NAME: 'vela',
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
        VITE_COGNITO_USER_POOL_ID: auth.userPool.userPoolId,
        VITE_COGNITO_USER_POOL_CLIENT_ID: auth.userPoolClient.userPoolClientId,
        COGNITO_CLIENT_ID: auth.userPoolClient.userPoolClientId,
        DDB_REGION: Stack.of(this).region,
      },
    });

    database.chatHistoryTable.grantReadWriteData(apiLambda);
    database.profilesTable.grantReadWriteData(apiLambda);
    database.vocabularyTable.grantReadWriteData(apiLambda);
    database.sentencesTable.grantReadWriteData(apiLambda);
    database.gameSessionsTable.grantReadWriteData(apiLambda);
    database.dailyProgressTable.grantReadWriteData(apiLambda);
    database.savedSentencesTable.grantReadWriteData(apiLambda);
    database.ttsSettingsTable.grantReadWriteData(apiLambda);

    apiLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:HeadObject',
          's3:ListBucket',
        ],
        resources: [`arn:aws:s3:::${ttsAudioBucketName}`, `arn:aws:s3:::${ttsAudioBucketName}/*`],
      }),
    );

    apiLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dsql:DbConnect'],
        resources: [database.dbClusterArn],
      }),
    );

    apiLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'cognito-idp:AdminConfirmSignUp',
          'cognito-idp:AdminGetUser',
          'cognito-idp:ListUsers',
        ],
        resources: [auth.userPool.userPoolArn],
      }),
    );

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

    const lambdaIntegration = new LambdaIntegration(apiLambda);

    const apiResource = api.root.addResource('api');
    apiResource.addProxy({
      defaultIntegration: lambdaIntegration,
      anyMethod: true,
    });

    this.api = api;
    this.apiLambda = apiLambda;
  }
}
