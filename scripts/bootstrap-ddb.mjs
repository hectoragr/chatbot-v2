import { DynamoDBClient, CreateTableCommand, DeleteTableCommand, ListTablesCommand, UpdateTableCommand, UpdateTimeToLiveCommand } from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION || "us-west-2";
const ENDPOINT = process.env.DDB_ENDPOINT; // used when LOCAL_DDB=true
const LOCAL = process.env.LOCAL_DDB === "true";

const clientConfig = {
  region: REGION
};

if (LOCAL && ENDPOINT) {
  // Local development configuration
  clientConfig.endpoint = ENDPOINT;
  clientConfig.credentials = {
    accessKeyId: "local",
    secretAccessKey: "local"
  };
} else {
  // Production configuration
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    };
  }
}

const client = new DynamoDBClient(clientConfig);

const Tables = {
  Tokens: process.env.DDB_TOKENS || "Tokens",
  Users: process.env.DDB_USERS || "Users", 
  Conversations: process.env.DDB_CONVERSATIONS || "Conversations",
  TokenRequests: process.env.DDB_TOKEN_REQUESTS || "TokenRequests",
  RateLimits: process.env.DDB_RATELIMITS || "RateLimits",
  Usage: process.env.DDB_USAGE || "Usage",
  Blocks: process.env.DDB_BLOCKS || "Blocks",
  Locales: process.env.DDB_LOCALES || "Locales",
  AdminDocs: process.env.DDB_ADMIN_DOCS || "AdminDocs"
};

async function ensureTable(params) {
  const existing = await client.send(new ListTablesCommand({}));
  if (existing.TableNames?.includes(params.TableName)) {
    console.log(`✔ Table exists: ${params.TableName}`);
    return;
  }
  await client.send(new CreateTableCommand(params));
  console.log(`➕ Created: ${params.TableName}`);
}

async function purgeAll() {
  const existing = await client.send(new ListTablesCommand({}));
  for (const name of [Tables.Tokens, Tables.Users, Tables.Conversations, Tables.TokenRequests, Tables.RateLimits, Tables.Usage, Tables.Blocks, Tables.Locales, Tables.AdminDocs]) {
    if (existing.TableNames?.includes(name)) {
      await client.send(new DeleteTableCommand({ TableName: name }));
      console.log(`🗑️ Deleted: ${name}`);
    }
  }
}

async function createTables() {
  const existing = await client.send(new ListTablesCommand({}));

  // Conversations table with GSIs
  if (!existing.TableNames?.includes(Tables.Conversations)) {
    await client.send(new CreateTableCommand({
      TableName: Tables.Conversations,
      KeySchema: [
        { AttributeName: "conversation_id", KeyType: "HASH" }
      ],
      AttributeDefinitions: [
        { AttributeName: "conversation_id", AttributeType: "S" },
        { AttributeName: "user_id", AttributeType: "S" },
        { AttributeName: "token_user", AttributeType: "S" },
        { AttributeName: "createdAt", AttributeType: "S" }
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "byUserCreatedAt",
          KeySchema: [
            { AttributeName: "user_id", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "byTokenUserCreatedAt",
          KeySchema: [
            { AttributeName: "token_user", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ],
      BillingMode: "PAY_PER_REQUEST"
    }));
    console.log(`➕ Created: ${Tables.Conversations}`);
  } else {
    console.log(`✅ Table exists: ${Tables.Conversations}`);
  }

  // Tokens table
  if (!existing.TableNames?.includes(Tables.Tokens)) {
    await client.send(new CreateTableCommand({
      TableName: Tables.Tokens,
      KeySchema: [
        { AttributeName: "token", KeyType: "HASH" }
      ],
      AttributeDefinitions: [
        { AttributeName: "token", AttributeType: "S" }
      ],
      BillingMode: "PAY_PER_REQUEST"
    }));
    console.log(`➕ Created: ${Tables.Tokens}`);
  } else {
    console.log(`✅ Table exists: ${Tables.Tokens}`);
  }

  // Users table
  if (!existing.TableNames?.includes(Tables.Users)) {
    await client.send(new CreateTableCommand({
      TableName: Tables.Users,
      KeySchema: [
        { AttributeName: "user_id", KeyType: "HASH" }
      ],
      AttributeDefinitions: [
        { AttributeName: "user_id", AttributeType: "S" }
      ],
      BillingMode: "PAY_PER_REQUEST"
    }));
    console.log(`➕ Created: ${Tables.Users}`);
  } else {
    console.log(`✅ Table exists: ${Tables.Users}`);
  }

  // TokenRequests table
  if (!existing.TableNames?.includes(Tables.TokenRequests)) {
    await client.send(new CreateTableCommand({
      TableName: Tables.TokenRequests,
      KeySchema: [
        { AttributeName: "token", KeyType: "HASH" }
      ],
      AttributeDefinitions: [
        { AttributeName: "token", AttributeType: "S" }
      ],
      BillingMode: "PAY_PER_REQUEST"
    }));
    console.log(`➕ Created: ${Tables.TokenRequests}`);
  } else {
    console.log(`✅ Table exists: ${Tables.TokenRequests}`);
  }

  // RateLimits table
  if (!existing.TableNames?.includes(Tables.RateLimits)) {
    await client.send(new CreateTableCommand({
      TableName: Tables.RateLimits,
      KeySchema: [
        { AttributeName: "key", KeyType: "HASH" }
      ],
      AttributeDefinitions: [
        { AttributeName: "key", AttributeType: "S" }
      ],
      TimeToLiveSpecification: {
        AttributeName: "ttl",
        Enabled: true
      },
      BillingMode: "PAY_PER_REQUEST"
    }));
    console.log(`➕ Created: ${Tables.RateLimits}`);
  } else {
    console.log(`✅ Table exists: ${Tables.RateLimits}`);
  }

  // Usage table (composite key + TTL)
  if (!existing.TableNames?.includes(Tables.Usage)) {
    await client.send(new CreateTableCommand({
      TableName: Tables.Usage,
      KeySchema: [
        { AttributeName: "subject", KeyType: "HASH" },
        { AttributeName: "period", KeyType: "RANGE" }
      ],
      AttributeDefinitions: [
        { AttributeName: "subject", AttributeType: "S" },
        { AttributeName: "period", AttributeType: "S" }
      ],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      BillingMode: "PAY_PER_REQUEST"
    }));
    console.log(`➕ Created: ${Tables.Usage}`);
  } else {
    console.log(`✅ Table exists: ${Tables.Usage}`);
  }

  // Blocks table (hash key + TTL)
  if (!existing.TableNames?.includes(Tables.Blocks)) {
    await client.send(new CreateTableCommand({
      TableName: Tables.Blocks,
      KeySchema: [
        { AttributeName: "subject", KeyType: "HASH" }
      ],
      AttributeDefinitions: [
        { AttributeName: "subject", AttributeType: "S" }
      ],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
      BillingMode: "PAY_PER_REQUEST"
    }));
    console.log(`➕ Created: ${Tables.Blocks}`);
  } else {
    console.log(`✅ Table exists: ${Tables.Blocks}`);
  }

  // Locales table (batch 2)
  await ensureTable({
    TableName: Tables.Locales,
    AttributeDefinitions: [{ AttributeName: "lang", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "lang", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST"
  });

  // AdminDocs table (batch 2)
  await ensureTable({
    TableName: Tables.AdminDocs,
    AttributeDefinitions: [{ AttributeName: "doc_id", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "doc_id", KeyType: "HASH" }],
    BillingMode: "PAY_PER_REQUEST"
  });

  // Conversations TTL (anon conversations expire after 30 days; attribute `ttl`).
  try {
    await client.send(new UpdateTimeToLiveCommand({
      TableName: Tables.Conversations,
      TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
    }));
    console.log("⏲  TTL enabled on Conversations (ttl)");
  } catch (e) {
    if (String(e?.message || e).includes("TimeToLive is already enabled")) {
      console.log("✔ TTL already enabled on Conversations");
    } else {
      console.log(`⚠ TTL enable skipped: ${e?.message ?? e}`);
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--purge")) {
    if (!args.has("--yes")) { console.error("Refusing to purge without --yes"); process.exit(2); }
    await purgeAll();
  }

  await createTables();

  console.log("✅ Bootstrap complete");
}

main().catch(e => { console.error(e); process.exit(1); });