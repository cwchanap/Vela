import './env';
import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

// Create DynamoDB client
const sanitize = (v?: string) => {
  if (!v) return undefined;
  const s = v.trim();
  if (!s || s === 'undefined' || s === 'null') return undefined;
  return s;
};

const endpointSanitized = sanitize(process.env.DDB_ENDPOINT);
const isLocalDdb =
  !!endpointSanitized &&
  (endpointSanitized.includes('localhost') ||
    endpointSanitized.includes('127.0.0.1') ||
    endpointSanitized.includes(':8000'));

const clientConfig: DynamoDBClientConfig = {
  region: sanitize(process.env.DDB_REGION) || process.env.AWS_REGION || 'us-east-1',
};

if (endpointSanitized) {
  // Only set endpoint when a valid value exists
  (clientConfig as any).endpoint = endpointSanitized;
}

// When using DynamoDB local, any credentials will do, but SDK still requires them
if (isLocalDdb) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  };
}

const client = new DynamoDBClient(clientConfig);

// Create DynamoDB document client
const docClient = DynamoDBDocumentClient.from(client);

// Debug: show resolved config in development
if (process.env.NODE_ENV === 'development') {
  console.log('[DynamoDB] Resolved config', {
    endpoint: endpointSanitized || 'AWS default',
    region: clientConfig.region,
    isLocal: isLocalDdb,
  });
}

// Table names from environment variables
const TABLE_NAMES = {
  PROFILES: process.env.PROFILES_TABLE_NAME || 'vela-profiles',
  VOCABULARY: process.env.VOCABULARY_TABLE_NAME || 'vela-vocabulary',
  SENTENCES: process.env.SENTENCES_TABLE_NAME || 'vela-sentences',
  GAME_SESSIONS: process.env.GAME_SESSIONS_TABLE_NAME || 'vela-game-sessions',
  DAILY_PROGRESS: process.env.DAILY_PROGRESS_TABLE_NAME || 'vela-daily-progress',
  CHAT_HISTORY: process.env.DYNAMODB_TABLE_NAME || process.env.DDB_TABLE || 'vela-chat-history',
  MY_DICTIONARIES:
    process.env.MY_DICTIONARIES_TABLE_NAME ||
    process.env.SAVED_SENTENCES_TABLE_NAME ||
    'vela-saved-sentences',
};

// Helper function to handle DynamoDB errors
function handleDynamoError(error: any): never {
  console.error('DynamoDB Error:', error);
  if (error.name === 'ConditionalCheckFailedException') {
    throw new Error('Item not found or condition not met');
  }
  throw new Error(`DynamoDB operation failed: ${error.message}`);
}

// Profiles operations
export const profiles = {
  async get(userId: string) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAMES.PROFILES,
        Key: { user_id: userId },
      });
      const response = await docClient.send(command);
      return response.Item;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async create(profile: any) {
    try {
      const command = new PutCommand({
        TableName: TABLE_NAMES.PROFILES,
        Item: profile,
      });
      await docClient.send(command);
      return profile;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async update(userId: string, updates: any) {
    try {
      const updateExpression =
        'SET ' +
        Object.keys(updates)
          .map((key) => `#${key} = :${key}`)
          .join(', ');
      const expressionAttributeNames = Object.keys(updates).reduce(
        (acc, key) => {
          acc[`#${key}`] = key;
          return acc;
        },
        {} as Record<string, string>,
      );
      const expressionAttributeValues = Object.keys(updates).reduce(
        (acc, key) => {
          acc[`:${key}`] = updates[key];
          return acc;
        },
        {} as Record<string, any>,
      );

      const command = new UpdateCommand({
        TableName: TABLE_NAMES.PROFILES,
        Key: { user_id: userId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      });
      const response = await docClient.send(command);
      return response.Attributes;
    } catch (error) {
      handleDynamoError(error);
    }
  },
};

// Vocabulary operations
export const vocabulary = {
  async getAll(limit: number = 10) {
    try {
      const command = new ScanCommand({
        TableName: TABLE_NAMES.VOCABULARY,
        Limit: limit,
      });
      const response = await docClient.send(command);
      return response.Items || [];
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async getById(id: string) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAMES.VOCABULARY,
        Key: { id },
      });
      const response = await docClient.send(command);
      return response.Item;
    } catch (error) {
      handleDynamoError(error);
    }
  },
};

// Sentences operations
export const sentences = {
  async getAll(limit: number = 5) {
    try {
      const command = new ScanCommand({
        TableName: TABLE_NAMES.SENTENCES,
        Limit: limit,
      });
      const response = await docClient.send(command);
      return response.Items || [];
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async getById(id: string) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAMES.SENTENCES,
        Key: { id },
      });
      const response = await docClient.send(command);
      return response.Item;
    } catch (error) {
      handleDynamoError(error);
    }
  },
};

// Game sessions operations
export const gameSessions = {
  async create(session: any) {
    try {
      // Generate a session ID if not provided
      const sessionId =
        session.session_id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const command = new PutCommand({
        TableName: TABLE_NAMES.GAME_SESSIONS,
        Item: {
          ...session,
          session_id: sessionId,
        },
      });
      await docClient.send(command);
      return { ...session, session_id: sessionId };
    } catch (error) {
      handleDynamoError(error);
    }
  },
};

// Daily progress operations
export const dailyProgress = {
  async getByUserAndDate(userId: string, date: string) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAMES.DAILY_PROGRESS,
        Key: {
          user_id: userId,
          date: date,
        },
      });
      const response = await docClient.send(command);
      return response.Item;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async create(progress: any) {
    try {
      const command = new PutCommand({
        TableName: TABLE_NAMES.DAILY_PROGRESS,
        Item: progress,
      });
      await docClient.send(command);
      return progress;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async update(userId: string, date: string, updates: any) {
    try {
      const updateExpression =
        'SET ' +
        Object.keys(updates)
          .map((key) => `#${key} = :${key}`)
          .join(', ');
      const expressionAttributeNames = Object.keys(updates).reduce(
        (acc, key) => {
          acc[`#${key}`] = key;
          return acc;
        },
        {} as Record<string, string>,
      );
      const expressionAttributeValues = Object.keys(updates).reduce(
        (acc, key) => {
          acc[`:${key}`] = updates[key];
          return acc;
        },
        {} as Record<string, any>,
      );

      const command = new UpdateCommand({
        TableName: TABLE_NAMES.DAILY_PROGRESS,
        Key: {
          user_id: userId,
          date: date,
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      });
      const response = await docClient.send(command);
      return response.Attributes;
    } catch (error) {
      handleDynamoError(error);
    }
  },
};

// My dictionaries operations
export const myDictionaries = {
  async create(userId: string, sentence: string, sourceUrl?: string, context?: string) {
    try {
      const sentenceId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const timestamp = Date.now();

      const command = new PutCommand({
        TableName: TABLE_NAMES.MY_DICTIONARIES,
        Item: {
          user_id: userId,
          sentence_id: sentenceId,
          sentence,
          source_url: sourceUrl,
          context,
          created_at: timestamp,
          updated_at: timestamp,
        },
      });
      await docClient.send(command);
      return {
        user_id: userId,
        sentence_id: sentenceId,
        sentence,
        source_url: sourceUrl,
        context,
        created_at: timestamp,
        updated_at: timestamp,
      };
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async getByUser(userId: string, limit: number = 50) {
    try {
      const command = new QueryCommand({
        TableName: TABLE_NAMES.MY_DICTIONARIES,
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        Limit: limit,
        ScanIndexForward: false, // Return most recent first
      });
      const response = await docClient.send(command);
      return response.Items || [];
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async delete(userId: string, sentenceId: string) {
    try {
      const command = new DeleteCommand({
        TableName: TABLE_NAMES.MY_DICTIONARIES,
        Key: {
          user_id: userId,
          sentence_id: sentenceId,
        },
      });
      await docClient.send(command);
      return { success: true };
    } catch (error) {
      handleDynamoError(error);
    }
  },
};

export { docClient, TABLE_NAMES };
