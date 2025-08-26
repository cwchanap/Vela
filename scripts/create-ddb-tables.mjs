import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const TABLE_NAME = 'VelaChatMessages';
const GSI_NAME = 'user_id-date-index';

// Local DynamoDB client
const client = new DynamoDBClient({
  region: 'local',
  endpoint: process.env.DDB_ENDPOINT || 'http://127.0.0.1:8000',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'dummy',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'dummy',
  },
});

async function tableExists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (e) {
    if (e?.name === 'ResourceNotFoundException') return false;
    throw e;
  }
}

async function createTable() {
  const exists = await tableExists(TABLE_NAME);
  if (exists) {
    console.log(`Table "${TABLE_NAME}" already exists`);
    return;
  }

  const cmd = new CreateTableCommand({
    TableName: TABLE_NAME,
    AttributeDefinitions: [
      { AttributeName: 'chat_id', AttributeType: 'S' },
      { AttributeName: 'date', AttributeType: 'S' },
      { AttributeName: 'user_id', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'chat_id', KeyType: 'HASH' }, // PK
      { AttributeName: 'date', KeyType: 'RANGE' }, // SK
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: GSI_NAME,
        KeySchema: [
          { AttributeName: 'user_id', KeyType: 'HASH' },
          { AttributeName: 'date', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });

  const res = await client.send(cmd);
  console.log(`CreateTable started:`, res.TableDescription?.TableStatus);

  // Since DynamoDB Local is immediate, no waiter needed; but a tiny delay helps
  await new Promise((r) => setTimeout(r, 500));
  const described = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
  console.log(`Table "${TABLE_NAME}" status:`, described.Table?.TableStatus);
}

createTable()
  .then(() => {
    console.log('Done');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed to create table', err);
    process.exit(1);
  });
