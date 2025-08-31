import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';

const TABLE_NAME = process.env.DDB_TABLE || 'VelaChatMessages';
const GSI_NAME = 'user_id-date-index';

// DynamoDB client configuration
const client = new DynamoDBClient({
  region: process.env.DDB_REGION || 'us-east-1',
  endpoint: process.env.DDB_ENDPOINT, // Only set if using local DynamoDB
  ...(process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY && {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    }),
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
        BillingMode: 'PAY_PER_REQUEST',
      },
    ],
    BillingMode: 'PAY_PER_REQUEST',
  });

  const res = await client.send(cmd);
  console.log(`CreateTable started:`, res.TableDescription?.TableStatus);

  // Wait for table to become active (may take some time for real DynamoDB)
  console.log('Waiting for table to become active...');
  let status = 'CREATING';
  while (status === 'CREATING') {
    await new Promise((r) => setTimeout(r, 2000)); // Wait 2 seconds
    const described = await client.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    status = described.Table?.TableStatus || 'UNKNOWN';
    console.log(`Table "${TABLE_NAME}" status:`, status);
  }

  if (status === 'ACTIVE') {
    console.log(`Table "${TABLE_NAME}" is now active and ready to use!`);
  } else {
    console.warn(`Table creation completed with status: ${status}`);
  }
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
