import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
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
  TTS_SETTINGS: process.env.TTS_SETTINGS_TABLE_NAME || 'vela-tts-settings',
  USER_VOCABULARY_PROGRESS:
    process.env.USER_VOCABULARY_PROGRESS_TABLE_NAME || 'vela-user-vocabulary-progress',
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

  /**
   * Get multiple vocabulary items by IDs in a single batch operation
   * @param ids - Array of vocabulary IDs to fetch
   * @returns Map of vocabulary items keyed by ID (undefined for missing items)
   */
  async getByIds(ids: string[]): Promise<Record<string, any>> {
    try {
      if (ids.length === 0) {
        return {};
      }

      // BatchGetCommand can handle up to 100 items in one request
      const command = new BatchGetCommand({
        RequestItems: {
          [TABLE_NAMES.VOCABULARY]: {
            Keys: ids.map((id) => ({ id })),
          },
        },
      });

      const response = await docClient.send(command);
      const items = response.Responses?.[TABLE_NAMES.VOCABULARY] || [];

      // Convert array of items to a map keyed by ID
      const vocabMap: Record<string, any> = {};
      for (const item of items) {
        if (item && item.id) {
          vocabMap[item.id] = item;
        }
      }

      return vocabMap;
    } catch (error) {
      handleDynamoError(error);
      return {};
    }
  },

  /**
   * Get vocabulary items filtered by JLPT level(s)
   * @param jlptLevels - Array of JLPT levels to filter (1-5, where 5=N5 easiest)
   * @param limit - Maximum number of items to return
   */
  async getByJlptLevel(jlptLevels: number[], limit: number = 10) {
    try {
      // Build filter expression for multiple JLPT levels
      const filterParts = jlptLevels.map((_, i) => `jlpt_level = :level${i}`);
      const filterExpression = filterParts.join(' OR ');
      const expressionAttributeValues = jlptLevels.reduce(
        (acc, level, i) => {
          acc[`:level${i}`] = level;
          return acc;
        },
        {} as Record<string, number>,
      );

      const allItems: any[] = [];
      let lastEvaluatedKey: any = undefined;
      const hardCap = 1000; // Prevent excessive scanning

      // Paginate scan until we have enough matching items or reach hard cap
      while (allItems.length < limit && allItems.length < hardCap) {
        const command = new ScanCommand({
          TableName: TABLE_NAMES.VOCABULARY,
          FilterExpression: filterExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const response = await docClient.send(command);
        const items = response.Items || [];

        // Collect all matching items from this page
        allItems.push(...items);

        // Check if we have more items to scan
        lastEvaluatedKey = response.LastEvaluatedKey;
        if (!lastEvaluatedKey) {
          break;
        }
      }

      // Shuffle all collected items and return up to limit
      return allItems.sort(() => Math.random() - 0.5).slice(0, limit);
    } catch (error) {
      handleDynamoError(error);
    }
    return [];
  },

  /**
   * Get random vocabulary items, optionally filtered by JLPT level
   * @param limit - Number of items to return
   * @param jlptLevels - Optional array of JLPT levels to filter
   */
  async getRandom(limit: number = 10, jlptLevels?: number[]) {
    try {
      let items: any[];

      if (jlptLevels && jlptLevels.length > 0) {
        items = (await this.getByJlptLevel(jlptLevels, limit)) || [];
      } else {
        const command = new ScanCommand({
          TableName: TABLE_NAMES.VOCABULARY,
          Limit: limit * 3,
        });
        const response = await docClient.send(command);
        items = response.Items || [];
      }

      // Shuffle and return requested limit
      return items.sort(() => Math.random() - 0.5).slice(0, limit);
    } catch (error) {
      handleDynamoError(error);
    }
    return [];
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

  /**
   * Get sentences filtered by JLPT level(s)
   * @param jlptLevels - Array of JLPT levels to filter (1-5, where 5=N5 easiest)
   * @param limit - Maximum number of items to return
   */
  async getByJlptLevel(jlptLevels: number[], limit: number = 5) {
    try {
      const filterParts = jlptLevels.map((_, i) => `jlpt_level = :level${i}`);
      const filterExpression = filterParts.join(' OR ');
      const expressionAttributeValues = jlptLevels.reduce(
        (acc, level, i) => {
          acc[`:level${i}`] = level;
          return acc;
        },
        {} as Record<string, number>,
      );

      const allItems: any[] = [];
      let lastEvaluatedKey: any = undefined;
      const hardCap = 1000; // Prevent excessive scanning

      // Paginate scan until we have enough matching items or reach hard cap
      while (allItems.length < limit && allItems.length < hardCap) {
        const command = new ScanCommand({
          TableName: TABLE_NAMES.SENTENCES,
          FilterExpression: filterExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const response = await docClient.send(command);
        const items = response.Items || [];

        // Collect all matching items from this page
        allItems.push(...items);

        // Check if we have more items to scan
        lastEvaluatedKey = response.LastEvaluatedKey;
        if (!lastEvaluatedKey) {
          break;
        }
      }

      // Shuffle all collected items and return up to limit
      return allItems.sort(() => Math.random() - 0.5).slice(0, limit);
    } catch (error) {
      handleDynamoError(error);
    }
    return [];
  },

  /**
   * Get random sentences, optionally filtered by JLPT level
   */
  async getRandom(limit: number = 5, jlptLevels?: number[]) {
    try {
      let items: any[];

      if (jlptLevels && jlptLevels.length > 0) {
        items = (await this.getByJlptLevel(jlptLevels, limit)) || [];
      } else {
        const command = new ScanCommand({
          TableName: TABLE_NAMES.SENTENCES,
          Limit: limit * 3,
        });
        const response = await docClient.send(command);
        items = response.Items || [];
      }

      return items.sort(() => Math.random() - 0.5).slice(0, limit);
    } catch (error) {
      handleDynamoError(error);
    }
    return [];
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

// Legacy alias for saved sentences (browser extension compatibility)
export const savedSentences = {
  create: myDictionaries.create,
};

// TTS Settings operations
interface TTSSSettings {
  user_id: string;
  api_key: string;
  voice_id: string | null;
  model: string | null;
  created_at?: number;
  updated_at?: number;
}

export const ttsSettings = {
  async get(userId: string) {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAMES.TTS_SETTINGS,
        Key: { user_id: userId },
      });
      const response = await docClient.send(command);
      return response.Item;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  async put(settings: Omit<TTSSSettings, 'created_at' | 'updated_at'>) {
    try {
      // Validate required user_id
      if (!settings.user_id || typeof settings.user_id !== 'string') {
        throw new Error('user_id is required and must be a string');
      }

      const timestamp = Date.now();
      const itemToStore: TTSSSettings = {
        ...settings,
        created_at: timestamp, // Always set created_at for new items
        updated_at: timestamp,
      };

      const command = new PutCommand({
        TableName: TABLE_NAMES.TTS_SETTINGS,
        Item: itemToStore,
      });
      await docClient.send(command);
      return itemToStore;
    } catch (error) {
      handleDynamoError(error);
    }
  },
};

// Types for User Vocabulary Progress (SRS tracking)
export interface UserVocabularyProgress {
  user_id: string;
  vocabulary_id: string;
  next_review_date: string;
  ease_factor: number;
  interval: number;
  repetitions: number;
  last_quality?: number;
  last_reviewed_at?: string;
  first_learned_at: string;
  total_reviews: number;
  correct_count: number;
}

// User Vocabulary Progress operations (SRS)
export const userVocabularyProgress = {
  /**
   * Get a specific progress record for a user-vocabulary pair
   */
  async get(userId: string, vocabularyId: string): Promise<UserVocabularyProgress | undefined> {
    try {
      const command = new GetCommand({
        TableName: TABLE_NAMES.USER_VOCABULARY_PROGRESS,
        Key: { user_id: userId, vocabulary_id: vocabularyId },
      });
      const response = await docClient.send(command);
      return response.Item as UserVocabularyProgress | undefined;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  /**
   * Get all progress records for a user
   */
  async getByUser(userId: string): Promise<UserVocabularyProgress[]> {
    try {
      let items: UserVocabularyProgress[] = [];
      let lastEvaluatedKey: any = undefined;

      do {
        const command = new QueryCommand({
          TableName: TABLE_NAMES.USER_VOCABULARY_PROGRESS,
          KeyConditionExpression: 'user_id = :userId',
          ExpressionAttributeValues: { ':userId': userId },
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const response = await docClient.send(command);
        if (response.Items) {
          items.push(...(response.Items as UserVocabularyProgress[]));
        }
        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      return items;
    } catch (error) {
      handleDynamoError(error);
    }
    return [];
  },

  /**
   * Get due items for a user (items where next_review_date <= now)
   * Note: This scans all user items and filters in application code
   * since DynamoDB doesn't support filtering on sort key with <= efficiently
   */
  async getDueItems(userId: string, now?: Date): Promise<UserVocabularyProgress[]> {
    try {
      const currentDate = now ?? new Date();
      const items = await this.getByUser(userId);
      return items
        .filter((item) => new Date(item.next_review_date) <= currentDate)
        .sort(
          (a, b) => new Date(a.next_review_date).getTime() - new Date(b.next_review_date).getTime(),
        );
    } catch (error) {
      handleDynamoError(error);
    }
    return [];
  },

  /**
   * Create or update a progress record
   */
  async put(progress: UserVocabularyProgress): Promise<UserVocabularyProgress> {
    try {
      const command = new PutCommand({
        TableName: TABLE_NAMES.USER_VOCABULARY_PROGRESS,
        Item: progress,
      });
      await docClient.send(command);
      return progress;
    } catch (error) {
      handleDynamoError(error);
    }
    return progress;
  },

  /**
   * Update progress after a review
   */
  async updateAfterReview(
    userId: string,
    vocabularyId: string,
    updates: {
      next_review_date: string;
      ease_factor: number;
      interval: number;
      repetitions: number;
      last_quality: number;
    },
  ): Promise<UserVocabularyProgress | undefined> {
    try {
      const command = new UpdateCommand({
        TableName: TABLE_NAMES.USER_VOCABULARY_PROGRESS,
        Key: { user_id: userId, vocabulary_id: vocabularyId },
        UpdateExpression:
          'SET next_review_date = :nrd, ease_factor = :ef, #interval = :i, repetitions = :r, ' +
          'last_quality = :lq, last_reviewed_at = :lra, total_reviews = if_not_exists(total_reviews, :zero) + :one, ' +
          'correct_count = if_not_exists(correct_count, :zero) + :correct',
        ExpressionAttributeNames: {
          '#interval': 'interval', // interval is a reserved word
        },
        ExpressionAttributeValues: {
          ':nrd': updates.next_review_date,
          ':ef': updates.ease_factor,
          ':i': updates.interval,
          ':r': updates.repetitions,
          ':lq': updates.last_quality,
          ':lra': new Date().toISOString(),
          ':zero': 0,
          ':one': 1,
          ':correct': updates.last_quality >= 3 ? 1 : 0,
        },
        ReturnValues: 'ALL_NEW',
      });
      const response = await docClient.send(command);
      return response.Attributes as UserVocabularyProgress | undefined;
    } catch (error) {
      handleDynamoError(error);
    }
  },

  /**
   * Initialize progress for a new vocabulary item
   */
  async initializeProgress(
    userId: string,
    vocabularyId: string,
    nextReviewDate: string,
  ): Promise<UserVocabularyProgress> {
    const progress: UserVocabularyProgress = {
      user_id: userId,
      vocabulary_id: vocabularyId,
      next_review_date: nextReviewDate,
      ease_factor: 2.5, // SM-2 default
      interval: 0,
      repetitions: 0,
      first_learned_at: new Date().toISOString(),
      total_reviews: 0,
      correct_count: 0,
    };
    return this.put(progress);
  },

  /**
   * Delete a progress record
   */
  async delete(userId: string, vocabularyId: string): Promise<void> {
    try {
      const command = new DeleteCommand({
        TableName: TABLE_NAMES.USER_VOCABULARY_PROGRESS,
        Key: { user_id: userId, vocabulary_id: vocabularyId },
      });
      await docClient.send(command);
    } catch (error) {
      handleDynamoError(error);
    }
  },

  /**
   * Get statistics for a user's SRS progress
   */
  async getStats(userId: string): Promise<{
    total_items: number;
    due_today: number;
    mastery_breakdown: {
      new: number;
      learning: number;
      reviewing: number;
      mastered: number;
    };
    average_ease_factor: number;
    total_reviews: number;
    accuracy_rate: number;
  }> {
    try {
      const items = await this.getByUser(userId);
      const now = new Date();
      const dueItems = items.filter((item) => new Date(item.next_review_date) <= now);

      // Calculate mastery breakdown
      const newItems = items.filter((item) => item.interval === 0);
      const learningItems = items.filter((item) => item.interval > 0 && item.interval < 21);
      const reviewingItems = items.filter((item) => item.interval >= 21 && item.interval < 60);
      const masteredItems = items.filter((item) => item.interval >= 60);

      const avgEaseFactor =
        items.length > 0
          ? items.reduce((sum, item) => sum + item.ease_factor, 0) / items.length
          : 0;

      const totalReviews = items.reduce((sum, item) => sum + item.total_reviews, 0);
      const correctCount = items.reduce((sum, item) => sum + item.correct_count, 0);
      const accuracyRate = totalReviews > 0 ? Math.round((correctCount / totalReviews) * 100) : 0;

      return {
        total_items: items.length,
        due_today: dueItems.length,
        mastery_breakdown: {
          new: newItems.length,
          learning: learningItems.length,
          reviewing: reviewingItems.length,
          mastered: masteredItems.length,
        },
        average_ease_factor: Math.round(avgEaseFactor * 100) / 100,
        total_reviews: totalReviews,
        accuracy_rate: accuracyRate,
      };
    } catch (error) {
      handleDynamoError(error);
    }
    return {
      total_items: 0,
      due_today: 0,
      mastery_breakdown: {
        new: 0,
        learning: 0,
        reviewing: 0,
        mastered: 0,
      },
      average_ease_factor: 0,
      total_reviews: 0,
      accuracy_rate: 0,
    };
  },
};
export { docClient, TABLE_NAMES };
