import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DatabaseStack } from '../lib/database-stack';

describe('DatabaseStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DSQL_DELETION_PROTECTION = 'false';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesizeTemplate() {
    const app = new App();
    const stack = new DatabaseStack(app, 'TestDatabaseStack', {
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });

    return { template: Template.fromStack(stack), stack };
  }

  test('creates chat history table with composite key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-chat-history',
      KeySchema: [
        { AttributeName: 'ThreadId', KeyType: 'HASH' },
        { AttributeName: 'Timestamp', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: 'ThreadId', AttributeType: 'S' },
        { AttributeName: 'Timestamp', AttributeType: 'N' },
      ]),
    });
  });

  test('creates chat history UserIdIndex GSI', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-chat-history',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'UserIdIndex',
          KeySchema: [
            { AttributeName: 'UserId', KeyType: 'HASH' },
            { AttributeName: 'Timestamp', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });
  });

  test('creates profiles table with user_id partition key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-profiles',
      KeySchema: [{ AttributeName: 'user_id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'user_id', AttributeType: 'S' }],
    });
  });

  test('creates vocabulary table with id partition key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-vocabulary',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    });
  });

  test('creates sentences table with id partition key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-sentences',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    });
  });

  test('creates game sessions table with composite key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-game-sessions',
      KeySchema: [
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'session_id', KeyType: 'RANGE' },
      ],
    });
  });

  test('creates daily progress table with composite key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-daily-progress',
      KeySchema: [
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'date', KeyType: 'RANGE' },
      ],
    });
  });

  test('creates saved sentences table with composite key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-saved-sentences',
      KeySchema: [
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'sentence_id', KeyType: 'RANGE' },
      ],
    });
  });

  test('creates TTS settings table with user_id partition key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-tts-settings',
      KeySchema: [{ AttributeName: 'user_id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'user_id', AttributeType: 'S' }],
    });
  });

  test('creates user vocabulary progress table with composite key', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-user-vocabulary-progress',
      KeySchema: [
        { AttributeName: 'user_id', KeyType: 'HASH' },
        { AttributeName: 'vocabulary_id', KeyType: 'RANGE' },
      ],
    });
  });

  test('creates NextReviewDateIndex GSI on user vocabulary progress table', () => {
    const { template } = synthesizeTemplate();

    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: 'vela-user-vocabulary-progress',
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'NextReviewDateIndex',
          KeySchema: [
            { AttributeName: 'user_id', KeyType: 'HASH' },
            { AttributeName: 'next_review_date', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });
  });

  test('creates Aurora DSQL cluster resource', () => {
    const { template } = synthesizeTemplate();

    template.hasResource('AWS::DSQL::Cluster', {
      Properties: {
        DeletionProtectionEnabled: false,
        Tags: [
          {
            Key: 'Name',
            Value: 'vela-aurora-dsql-cluster',
          },
        ],
      },
    });
  });

  test('creates exactly 9 DynamoDB tables', () => {
    const { template } = synthesizeTemplate();

    template.resourceCountIs('AWS::DynamoDB::Table', 9);
  });

  test('all tables use PAY_PER_REQUEST billing', () => {
    const { template } = synthesizeTemplate();

    const tables = template.findResources('AWS::DynamoDB::Table');
    const allTables = Object.values(tables);

    for (const table of allTables) {
      expect(table.Properties.BillingMode).toBe('PAY_PER_REQUEST');
    }
  });

  test('all tables have point-in-time recovery enabled', () => {
    const { template } = synthesizeTemplate();

    const tables = template.findResources('AWS::DynamoDB::Table');
    const allTables = Object.values(tables);

    for (const table of allTables) {
      expect(table.Properties.PointInTimeRecoverySpecification).toEqual({
        PointInTimeRecoveryEnabled: true,
      });
    }
  });

  test('enables deletion protection on DSQL cluster when env var is true', () => {
    process.env.DSQL_DELETION_PROTECTION = 'true';

    const { template } = synthesizeTemplate();

    template.hasResource('AWS::DSQL::Cluster', {
      Properties: {
        DeletionProtectionEnabled: true,
      },
    });
  });

  test('exposes table references as public properties', () => {
    const { stack } = synthesizeTemplate();

    expect(stack.chatHistoryTable).toBeDefined();
    expect(stack.profilesTable).toBeDefined();
    expect(stack.vocabularyTable).toBeDefined();
    expect(stack.sentencesTable).toBeDefined();
    expect(stack.gameSessionsTable).toBeDefined();
    expect(stack.dailyProgressTable).toBeDefined();
    expect(stack.savedSentencesTable).toBeDefined();
    expect(stack.ttsSettingsTable).toBeDefined();
    expect(stack.userVocabularyProgressTable).toBeDefined();
    expect(stack.dbClusterArn).toBeDefined();
    expect(stack.dbClusterEndpoint).toBeDefined();
  });
});
