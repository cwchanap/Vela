import { Stack, StackProps, RemovalPolicy, CfnResource } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

declare const process: any;

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
  public readonly userVocabularyProgressTable: Table;

  public readonly vpc: ec2.Vpc;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly dbClusterArn: string;
  public readonly dbClusterEndpoint: string;

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

    // SRS (Spaced Repetition System) User Vocabulary Progress table
    // Tracks individual word mastery using SM-2 algorithm
    const userVocabularyProgressTable = new Table(this, 'VelaUserVocabularyProgressTable', {
      tableName: 'vela-user-vocabulary-progress',
      partitionKey: {
        name: 'user_id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'vocabulary_id',
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // Add GSI for querying due items by next_review_date
    // This allows efficient queries like "get all due items for user"
    userVocabularyProgressTable.addGlobalSecondaryIndex({
      indexName: 'NextReviewDateIndex',
      partitionKey: {
        name: 'user_id',
        type: AttributeType.STRING,
      },
      sortKey: {
        name: 'next_review_date',
        type: AttributeType.STRING,
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

    // Legacy security group that was previously imported by ApiStack for Lambda VPC networking.
    // ApiStack now uses its own VelaApiSecurityGroup; this SG is retained for potential future use.
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'VelaDBSecurityGroup', {
      vpc,
      description: 'Security group for Aurora DSQL database',
      allowAllOutbound: true,
    });

    dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4('10.0.0.0/16'),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from VPC',
    );

    const dsqlCluster = new CfnResource(this, 'VelaAuroraDsqlCluster', {
      type: 'AWS::DSQL::Cluster',
      properties: {
        DeletionProtectionEnabled: process.env.DSQL_DELETION_PROTECTION === 'true',
        Tags: [
          {
            Key: 'Name',
            Value: 'vela-aurora-dsql-cluster',
          },
        ],
      },
    });

    const dbClusterArn = dsqlCluster.getAtt('ResourceArn').toString();
    // Use the Endpoint attribute because AuroraDSQLClient.host expects the cluster connection endpoint hostname.
    const dbClusterEndpoint = dsqlCluster.getAtt('Endpoint').toString();

    this.chatHistoryTable = chatHistoryTable;
    this.profilesTable = profilesTable;
    this.vocabularyTable = vocabularyTable;
    this.sentencesTable = sentencesTable;
    this.gameSessionsTable = gameSessionsTable;
    this.dailyProgressTable = dailyProgressTable;
    this.savedSentencesTable = savedSentencesTable;
    this.ttsSettingsTable = ttsSettingsTable;
    this.userVocabularyProgressTable = userVocabularyProgressTable;

    this.vpc = vpc;
    this.dbSecurityGroup = dbSecurityGroup;
    this.dbClusterArn = dbClusterArn;
    this.dbClusterEndpoint = dbClusterEndpoint;
  }
}
