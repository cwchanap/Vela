import { Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface DatabaseStackProps extends StackProps {}

export class DatabaseStack extends Stack {
  public readonly chatHistoryTable: Table;
  public readonly profilesTable: Table;
  public readonly vocabularyTable: Table;
  public readonly sentencesTable: Table;
  public readonly gameSessionsTable: Table;
  public readonly dailyProgressTable: Table;
  public readonly savedSentencesTable: Table;
  public readonly ttsSettingsTable: Table;

  public readonly vpc: ec2.Vpc;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly dbCredentials: secretsmanager.Secret;
  public readonly dbCluster: rds.DatabaseCluster;

  constructor(scope: Construct, id: string, props?: DatabaseStackProps) {
    super(scope, id, props);

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

    const ttsSettingsTable = new Table(this, 'VelaTTSSettingsTable', {
      tableName: 'vela-tts-settings',
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

    const vpc = new ec2.Vpc(this, 'VelaVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'private-with-egress',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'VelaDBSecurityGroup', {
      vpc,
      description: 'Security group for Aurora DSQL database',
      allowAllOutbound: true,
    });

    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from VPC',
    );

    const dbCredentials = new secretsmanager.Secret(this, 'VelaDBCredentials', {
      secretName: 'vela-aurora-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'vela_admin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    const dbCluster = new rds.DatabaseCluster(this, 'VelaAuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromSecret(dbCredentials),
      writer: rds.ClusterInstance.serverlessV2('writer', {
        publiclyAccessible: false,
      }),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [dbSecurityGroup],
      defaultDatabaseName: 'vela',
      removalPolicy: RemovalPolicy.DESTROY,
      serverlessV2MinCapacity: 0.5,
      serverlessV2MaxCapacity: 1,
    });

    this.chatHistoryTable = chatHistoryTable;
    this.profilesTable = profilesTable;
    this.vocabularyTable = vocabularyTable;
    this.sentencesTable = sentencesTable;
    this.gameSessionsTable = gameSessionsTable;
    this.dailyProgressTable = dailyProgressTable;
    this.savedSentencesTable = savedSentencesTable;
    this.ttsSettingsTable = ttsSettingsTable;

    this.vpc = vpc;
    this.dbSecurityGroup = dbSecurityGroup;
    this.dbCredentials = dbCredentials;
    this.dbCluster = dbCluster;
  }
}
