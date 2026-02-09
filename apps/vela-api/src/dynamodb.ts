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

export interface Profile {
  user_id: string;
  email?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  native_language?: string;
  current_level?: number;
  total_experience?: number;
  learning_streak?: number;
  preferences?: Record<string, unknown>;
  last_activity?: string;
  created_at?: string;
  updated_at?: string;
}

export interface GameSession {
  session_id?: string;
  user_id: string;
  game_type: string;
  score: number;
  duration_seconds: number;
  questions_answered: number;
  correct_answers: number;
  experience_gained: number;
  created_at?: string;
}

export interface DailyProgress {
  user_id: string;
  date: string;
  vocabulary_studied: number;
  sentences_completed: number;
  time_spent_minutes: number;
  experience_gained: number;
  games_played: number;
  accuracy_percentage: number;
}

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
  (clientConfig as Record<string, unknown>).endpoint = endpointSanitized;
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

// Fisher-Yates shuffle algorithm for uniform random shuffling
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Shared helper: scan a table filtered by JLPT level(s) with pagination and hard cap.
 * Returns up to `limit` shuffled items matching the given JLPT levels.
 */
async function scanByJlptLevel(tableName: string, jlptLevels: number[], limit: number) {
  // Guard clause: return empty array if no levels specified
  if (jlptLevels.length === 0) {
    return [];
  }

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
  let scannedCount = 0;
  // Hard cap to prevent excessive scanning - log warning when approaching limit
  const hardCap = 1000;
  const warningThreshold = 800; // Warn when we're close to cap

  // Paginate scan until we have enough matching items or reach hard cap
  while (allItems.length < limit && scannedCount < hardCap) {
    const remainingScanBudget = hardCap - scannedCount;
    const command = new ScanCommand({
      TableName: tableName,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ExclusiveStartKey: lastEvaluatedKey,
      Limit: remainingScanBudget,
    });

    const response = await docClient.send(command);
    const items = response.Items || [];
    const scannedThisPageRaw =
      typeof response.ScannedCount === 'number' ? response.ScannedCount : items.length;
    const scannedThisPage = Math.min(scannedThisPageRaw, remainingScanBudget);

    // Collect all matching items from this page
    allItems.push(...items);

    scannedCount += scannedThisPage;

    // Log warning if approaching hard cap
    if (scannedCount >= warningThreshold && scannedCount - scannedThisPage < warningThreshold) {
      console.warn(
        `[scanByJlptLevel] Approaching hard cap: scanned ${scannedCount} items in ${tableName} for JLPT levels [${jlptLevels.join(', ')}]. Consider increasing hardCap or implementing GSI for more efficient querying.`,
      );
    }

    // Check if we have more items to scan
    lastEvaluatedKey = response.LastEvaluatedKey;
    if (!lastEvaluatedKey) {
      break;
    }
  }

  // Shuffle all collected items and return up to limit
  return shuffleArray(allItems).slice(0, limit);
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

  async create(profile: Profile) {
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

  async update(userId: string, updates: Partial<Omit<Profile, 'user_id'>>) {
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
   * Get multiple vocabulary items by IDs with automatic chunking and retry for UnprocessedKeys
   * @param ids - Array of vocabulary IDs to fetch
   * @returns Map of vocabulary items keyed by ID (undefined for missing items)
   */
  async getByIds(ids: string[]): Promise<Record<string, Record<string, unknown>>> {
    try {
      if (ids.length === 0) {
        return {};
      }

      // BatchGetCommand can handle up to 100 items in one request
      const BATCH_SIZE = 100;
      const MAX_RETRY_ATTEMPTS = 3;
      const INITIAL_RETRY_DELAY_MS = 100;

      // Aggregate all items across all batch requests
      const allItems: any[] = [];

      // Helper function to process a single batch with retry logic for UnprocessedKeys
      const processBatchWithRetry = async (keys: any[]): Promise<void> => {
        let remainingKeys = [...keys];
        let attempt = 0;

        while (remainingKeys.length > 0 && attempt < MAX_RETRY_ATTEMPTS) {
          const command = new BatchGetCommand({
            RequestItems: {
              [TABLE_NAMES.VOCABULARY]: {
                Keys: remainingKeys.slice(0, BATCH_SIZE),
              },
            },
          });

          const response = await docClient.send(command);
          const items = response.Responses?.[TABLE_NAMES.VOCABULARY] || [];
          allItems.push(...items);

          // Check for UnprocessedKeys and retry them
          if (response.UnprocessedKeys && response.UnprocessedKeys[TABLE_NAMES.VOCABULARY]) {
            remainingKeys = response.UnprocessedKeys[TABLE_NAMES.VOCABULARY].Keys || [];

            if (remainingKeys.length > 0) {
              attempt++;
              if (attempt < MAX_RETRY_ATTEMPTS) {
                // Exponential backoff
                const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
          } else {
            // No unprocessed keys, we're done with this batch
            remainingKeys = [];
          }
        }

        if (remainingKeys.length > 0) {
          console.warn(
            `Failed to process ${remainingKeys.length} vocabulary items after ${MAX_RETRY_ATTEMPTS} attempts`,
          );
        }
      };

      // Process all IDs in chunks
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const chunk = ids.slice(i, i + BATCH_SIZE);
        const keys = chunk.map((id) => ({ id }));
        await processBatchWithRetry(keys);
      }

      // Convert array of items to a map keyed by ID
      const vocabMap: Record<string, Record<string, unknown>> = {};
      for (const item of allItems) {
        if (item && item.id) {
          vocabMap[item.id] = item;
        }
      }

      return vocabMap;
    } catch (error) {
      handleDynamoError(error);
    }
    return {};
  },

  /**
   * Get vocabulary items filtered by JLPT level(s)
   * @param jlptLevels - Array of JLPT levels to filter (1-5, where 5=N5 easiest)
   * @param limit - Maximum number of items to return
   */
  async getByJlptLevel(jlptLevels: number[], limit: number = 10) {
    try {
      return await scanByJlptLevel(TABLE_NAMES.VOCABULARY, jlptLevels, limit);
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
      return shuffleArray(items).slice(0, limit);
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
      return await scanByJlptLevel(TABLE_NAMES.SENTENCES, jlptLevels, limit);
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

      return shuffleArray(items).slice(0, limit);
    } catch (error) {
      handleDynamoError(error);
    }
    return [];
  },
};

// Game sessions operations
export const gameSessions = {
  async create(session: GameSession) {
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

  async create(progress: DailyProgress) {
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

  async update(
    userId: string,
    date: string,
    updates: Partial<Omit<DailyProgress, 'user_id' | 'date'>>,
  ) {
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
   * Uses the NextReviewDateIndex GSI for efficient querying
   */
  async getDueItems(userId: string, now?: Date): Promise<UserVocabularyProgress[]> {
    try {
      const currentDate = now ?? new Date();
      const currentTimestamp = currentDate.toISOString();

      let items: UserVocabularyProgress[] = [];
      let lastEvaluatedKey: any = undefined;

      do {
        const command = new QueryCommand({
          TableName: TABLE_NAMES.USER_VOCABULARY_PROGRESS,
          IndexName: 'NextReviewDateIndex',
          KeyConditionExpression: 'user_id = :userId AND next_review_date <= :now',
          ExpressionAttributeValues: {
            ':userId': userId,
            ':now': currentTimestamp,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        });

        const response = await docClient.send(command);
        if (response.Items) {
          items.push(...(response.Items as UserVocabularyProgress[]));
        }
        lastEvaluatedKey = response.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      // Sort by next_review_date (most overdue first)
      return items.sort(
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
   * Returns undefined if the item doesn't exist (condition check fails)
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
        ConditionExpression: 'attribute_exists(user_id)',
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
    } catch (error: any) {
      // Return undefined for conditional check failures (item doesn't exist)
      if (error.name === 'ConditionalCheckFailedException') {
        return undefined;
      }
      // For other errors, handle them as before
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
