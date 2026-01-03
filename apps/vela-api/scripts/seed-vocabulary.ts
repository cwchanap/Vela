/**
 * Seed script to add sample Japanese vocabulary to DynamoDB
 * Run with: cd apps/vela-api && bun scripts/seed-vocabulary.ts
 */
import { DynamoDBClient, type DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load .env file manually
function loadEnv() {
  try {
    const envPath = join(import.meta.dir, '../.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=');
        if (key && value) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    console.log('No .env file found, using environment variables');
  }
}

loadEnv();

// Configure DynamoDB client (same as main app)
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
  clientConfig.endpoint = endpointSanitized;
}

if (isLocalDdb) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local',
  };
}

const client = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(client);

const VOCABULARY_TABLE = process.env.VOCABULARY_TABLE_NAME || 'vela-vocabulary';

interface VocabularyItem {
  id: string;
  japanese: string;
  hiragana: string;
  romaji: string;
  english_translation: string;
  jlpt_level: number; // 5=N5, 4=N4, 3=N3, 2=N2, 1=N1
  category: string;
  created_at: string;
  updated_at: string;
}

// Sample vocabulary data with JLPT levels
const sampleVocabulary: Omit<VocabularyItem, 'id' | 'created_at' | 'updated_at'>[] = [
  // N5 (Beginner) - Most basic vocabulary
  {
    japanese: '食べる',
    hiragana: 'たべる',
    romaji: 'taberu',
    english_translation: 'to eat',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '飲む',
    hiragana: 'のむ',
    romaji: 'nomu',
    english_translation: 'to drink',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '行く',
    hiragana: 'いく',
    romaji: 'iku',
    english_translation: 'to go',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '来る',
    hiragana: 'くる',
    romaji: 'kuru',
    english_translation: 'to come',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '見る',
    hiragana: 'みる',
    romaji: 'miru',
    english_translation: 'to see',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '書く',
    hiragana: 'かく',
    romaji: 'kaku',
    english_translation: 'to write',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '読む',
    hiragana: 'よむ',
    romaji: 'yomu',
    english_translation: 'to read',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '聞く',
    hiragana: 'きく',
    romaji: 'kiku',
    english_translation: 'to listen',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '話す',
    hiragana: 'はなす',
    romaji: 'hanasu',
    english_translation: 'to speak',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '買う',
    hiragana: 'かう',
    romaji: 'kau',
    english_translation: 'to buy',
    jlpt_level: 5,
    category: 'verb',
  },
  {
    japanese: '水',
    hiragana: 'みず',
    romaji: 'mizu',
    english_translation: 'water',
    jlpt_level: 5,
    category: 'noun',
  },
  {
    japanese: '本',
    hiragana: 'ほん',
    romaji: 'hon',
    english_translation: 'book',
    jlpt_level: 5,
    category: 'noun',
  },
  {
    japanese: '学校',
    hiragana: 'がっこう',
    romaji: 'gakkou',
    english_translation: 'school',
    jlpt_level: 5,
    category: 'noun',
  },
  {
    japanese: '電車',
    hiragana: 'でんしゃ',
    romaji: 'densha',
    english_translation: 'train',
    jlpt_level: 5,
    category: 'noun',
  },
  {
    japanese: '大きい',
    hiragana: 'おおきい',
    romaji: 'ookii',
    english_translation: 'big',
    jlpt_level: 5,
    category: 'adjective',
  },

  // N4 (Elementary) - Basic vocabulary
  {
    japanese: '働く',
    hiragana: 'はたらく',
    romaji: 'hataraku',
    english_translation: 'to work',
    jlpt_level: 4,
    category: 'verb',
  },
  {
    japanese: '疲れる',
    hiragana: 'つかれる',
    romaji: 'tsukareru',
    english_translation: 'to get tired',
    jlpt_level: 4,
    category: 'verb',
  },
  {
    japanese: '覚える',
    hiragana: 'おぼえる',
    romaji: 'oboeru',
    english_translation: 'to remember',
    jlpt_level: 4,
    category: 'verb',
  },
  {
    japanese: '忘れる',
    hiragana: 'わすれる',
    romaji: 'wasureru',
    english_translation: 'to forget',
    jlpt_level: 4,
    category: 'verb',
  },
  {
    japanese: '届く',
    hiragana: 'とどく',
    romaji: 'todoku',
    english_translation: 'to reach',
    jlpt_level: 4,
    category: 'verb',
  },
  {
    japanese: '経験',
    hiragana: 'けいけん',
    romaji: 'keiken',
    english_translation: 'experience',
    jlpt_level: 4,
    category: 'noun',
  },
  {
    japanese: '趣味',
    hiragana: 'しゅみ',
    romaji: 'shumi',
    english_translation: 'hobby',
    jlpt_level: 4,
    category: 'noun',
  },
  {
    japanese: '約束',
    hiragana: 'やくそく',
    romaji: 'yakusoku',
    english_translation: 'promise',
    jlpt_level: 4,
    category: 'noun',
  },
  {
    japanese: '準備',
    hiragana: 'じゅんび',
    romaji: 'junbi',
    english_translation: 'preparation',
    jlpt_level: 4,
    category: 'noun',
  },
  {
    japanese: '複雑',
    hiragana: 'ふくざつ',
    romaji: 'fukuzatsu',
    english_translation: 'complicated',
    jlpt_level: 4,
    category: 'adjective',
  },

  // N3 (Intermediate)
  {
    japanese: '確認',
    hiragana: 'かくにん',
    romaji: 'kakunin',
    english_translation: 'confirmation',
    jlpt_level: 3,
    category: 'noun',
  },
  {
    japanese: '説明',
    hiragana: 'せつめい',
    romaji: 'setsumei',
    english_translation: 'explanation',
    jlpt_level: 3,
    category: 'noun',
  },
  {
    japanese: '連絡',
    hiragana: 'れんらく',
    romaji: 'renraku',
    english_translation: 'contact',
    jlpt_level: 3,
    category: 'noun',
  },
  {
    japanese: '影響',
    hiragana: 'えいきょう',
    romaji: 'eikyou',
    english_translation: 'influence',
    jlpt_level: 3,
    category: 'noun',
  },
  {
    japanese: '状況',
    hiragana: 'じょうきょう',
    romaji: 'joukyou',
    english_translation: 'situation',
    jlpt_level: 3,
    category: 'noun',
  },
  {
    japanese: '提案',
    hiragana: 'ていあん',
    romaji: 'teian',
    english_translation: 'proposal',
    jlpt_level: 3,
    category: 'noun',
  },
  {
    japanese: '適当',
    hiragana: 'てきとう',
    romaji: 'tekitou',
    english_translation: 'suitable',
    jlpt_level: 3,
    category: 'adjective',
  },
  {
    japanese: '重要',
    hiragana: 'じゅうよう',
    romaji: 'juuyou',
    english_translation: 'important',
    jlpt_level: 3,
    category: 'adjective',
  },

  // N2 (Upper Intermediate)
  {
    japanese: '概念',
    hiragana: 'がいねん',
    romaji: 'gainen',
    english_translation: 'concept',
    jlpt_level: 2,
    category: 'noun',
  },
  {
    japanese: '傾向',
    hiragana: 'けいこう',
    romaji: 'keikou',
    english_translation: 'tendency',
    jlpt_level: 2,
    category: 'noun',
  },
  {
    japanese: '把握',
    hiragana: 'はあく',
    romaji: 'haaku',
    english_translation: 'grasp',
    jlpt_level: 2,
    category: 'noun',
  },
  {
    japanese: '推測',
    hiragana: 'すいそく',
    romaji: 'suisoku',
    english_translation: 'guess',
    jlpt_level: 2,
    category: 'noun',
  },
  {
    japanese: '妥当',
    hiragana: 'だとう',
    romaji: 'datou',
    english_translation: 'appropriate',
    jlpt_level: 2,
    category: 'adjective',
  },

  // N1 (Advanced)
  {
    japanese: '概況',
    hiragana: 'がいきょう',
    romaji: 'gaikyou',
    english_translation: 'overview',
    jlpt_level: 1,
    category: 'noun',
  },
  {
    japanese: '網羅',
    hiragana: 'もうら',
    romaji: 'moura',
    english_translation: 'comprehensive coverage',
    jlpt_level: 1,
    category: 'noun',
  },
  {
    japanese: '顕著',
    hiragana: 'けんちょ',
    romaji: 'kencho',
    english_translation: 'prominent',
    jlpt_level: 1,
    category: 'adjective',
  },
  {
    japanese: '膨大',
    hiragana: 'ぼうだい',
    romaji: 'boudai',
    english_translation: 'enormous',
    jlpt_level: 1,
    category: 'adjective',
  },
];

async function seedVocabulary() {
  console.log(`Seeding vocabulary to table: ${VOCABULARY_TABLE}`);
  console.log(`DynamoDB endpoint: ${endpointSanitized || 'AWS default (production)'}`);
  console.log(`Region: ${clientConfig.region}`);

  const now = new Date().toISOString();

  // Add items in batches of 25 (DynamoDB limit)
  const items: VocabularyItem[] = sampleVocabulary.map((v) => ({
    ...v,
    id: randomUUID(),
    created_at: now,
    updated_at: now,
  }));

  // Split into batches of 25
  const batches: VocabularyItem[][] = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  const MAX_RETRIES = 5;
  const INITIAL_DELAY_MS = 100;

  for (const batch of batches) {
    const putRequests = batch.map((item) => ({
      PutRequest: {
        Item: item,
      },
    }));

    let unprocessedItems = putRequests;
    let attempt = 0;
    let success = false;

    // Retry loop for batch writes
    while (attempt < MAX_RETRIES && unprocessedItems.length > 0) {
      attempt++;
      const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);

      if (attempt > 1) {
        console.log(
          `Retry attempt ${attempt}/${MAX_RETRIES} for ${unprocessedItems.length} unprocessed items (delay: ${delay}ms)`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        const response = await docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [VOCABULARY_TABLE]: unprocessedItems,
            },
          }),
        );

        // Check for unprocessed items
        unprocessedItems = (response.UnprocessedItems?.[VOCABULARY_TABLE] ||
          []) as typeof putRequests;

        if (unprocessedItems.length === 0) {
          success = true;
          console.log(`Added ${batch.length} vocabulary items`);
          break;
        }
      } catch (error) {
        console.error(`Error on attempt ${attempt}/${MAX_RETRIES}:`, error);

        // If this is the last attempt, fall back to individual puts
        if (attempt >= MAX_RETRIES) {
          console.log(
            `Max retries reached, falling back to individual puts for ${unprocessedItems.length} items`,
          );
        }
      }
    }

    // Fallback to individual puts for any remaining unprocessed items
    if (!success && unprocessedItems.length > 0) {
      console.log(`Falling back to individual puts for ${unprocessedItems.length} items`);

      for (const request of unprocessedItems) {
        const item = request.PutRequest.Item as VocabularyItem;
        try {
          await docClient.send(
            new PutCommand({
              TableName: VOCABULARY_TABLE,
              Item: item,
            }),
          );
          console.log(`Added: ${item.japanese} (${item.english_translation})`);
        } catch (itemError) {
          console.error(`Failed to add ${item.japanese}:`, itemError);
        }
      }
    }
  }

  console.log(`\nSeeding complete! Added ${items.length} vocabulary items.`);
  console.log('\nBreakdown by JLPT level:');
  console.log(`  N5: ${items.filter((i) => i.jlpt_level === 5).length} items`);
  console.log(`  N4: ${items.filter((i) => i.jlpt_level === 4).length} items`);
  console.log(`  N3: ${items.filter((i) => i.jlpt_level === 3).length} items`);
  console.log(`  N2: ${items.filter((i) => i.jlpt_level === 2).length} items`);
  console.log(`  N1: ${items.filter((i) => i.jlpt_level === 1).length} items`);
}

seedVocabulary().catch(console.error);
