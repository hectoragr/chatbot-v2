import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

let doc: DynamoDBDocumentClient | null = null;

export function ddb() {
  if (doc) return doc;
  const { AWS_REGION, DDB_ENDPOINT, LOCAL_DDB } = process.env;
  const client = new DynamoDBClient({
    region: AWS_REGION || 'us-east-1',
    ...(LOCAL_DDB === 'true' && DDB_ENDPOINT ? { endpoint: DDB_ENDPOINT, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  });
  doc = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  return doc;
}

export const TABLES = {
  Tokens: process.env.DDB_TOKENS || 'Tokens',
  Users: process.env.DDB_USERS || 'Users',
  Conversations: process.env.DDB_CONVERSATIONS || 'Conversations',
  RateLimits: process.env.DDB_RATELIMITS || 'RateLimits',
  TokenRequests: process.env.DDB_TOKENS_REQUEST || 'TokenRequests',
  Usage: process.env.DDB_USAGE || 'Usage',
  Blocks: process.env.DDB_BLOCKS || 'Blocks',
  Locales: process.env.DDB_LOCALES || 'Locales',
  AdminDocs: process.env.DDB_ADMIN_DOCS || 'AdminDocs',
};

export type TokenDoc = {
  token: string;
  user_id: string;
  provider: 'OPENAI' | 'DEEPSEEK' | 'ANY' | 'BEDROCK';
  model?: string;
  limit: number;
  used: number;
  isActive: boolean;
  expiresAt?: string; // ISO
  createdAt: string;
  updatedAt: string;
};

export type UserDoc = {
  user_id: string;
  email?: string;
  name?: string;
  company?: string;
  auth0_sub?: string;
  approved?: boolean;
  dailyLimit?: number; // default 1000
  pendingDelete?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

export type ConversationDoc = {
  conversation_id: string;
  token: string;
  user_id: string;
  displayName: string;
  token_user: string; // `${token}#${user_id}`
  createdAt: string;
  updatedAt: string;
  provider: 'OPENAI' | 'DEEPSEEK' | 'ANY' | 'BEDROCK';
  messages: Message[];
  hidden?: boolean;
  ip?: string;      // anon conversations only
  ttl?: number;     // epoch seconds; anon conversations expire (~30 days)
};

// Optional: type for RateLimits table (handy for debugging)
export type RateLimitDoc = {
  key: string; // "email:alice@example.com|/completions|28934736"
  count: number; // incremented per request in window
  ttl: number; // epoch seconds; DynamoDB TTL enabled on this attribute
};

export type TokenRequestDoc = {
  token: string;
  user_id: string;
  name: string;
  processed: boolean;
  denied?: boolean;
  createdAt: string;
  updatedAt: string;
  provider: 'OPENAI' | 'DEEPSEEK' | 'ANY' | 'BEDROCK';
  limit: number;
  company?: string;
  reason?: string;
  ip?: string;
}

export type UsageDoc = {
  subject: string;   // "anon:<id>" | "ip:<ip>" | "user:<email>"
  period: string;    // "lifetime" | "YYYY-MM-DD"
  questions: number;
  tokens: number;
  ttl: number;       // epoch seconds
};

export type BlockDoc = {
  subject: string;   // "user:<email>" | "ip:<ip>"
  reason: string;
  source: 'manual' | 'auto';
  createdAt: string;
  ttl?: number;      // epoch seconds; omitted for manual (permanent) blocks
};

export interface LocaleDoc {
  lang: string;              // BCP-47 code, table key
  name: string;              // native display name
  rtl: boolean;
  translations: Record<string, string>;
  usageCount: number;
  createdAt: string;
  lastUsedAt: string;
}

export interface AdminDocDoc {
  doc_id: string;            // slug, table key
  title: string;
  topics: string;            // comma-separated keywords shown to the classifier
  content: string;           // markdown, <= 300KB
  updatedAt: string;
}
