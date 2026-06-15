import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLES } from './ddb.js';
import type { UsageDoc } from './ddb.js';

export function todayPeriod(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function getUsage(subject: string, period: string): Promise<UsageDoc> {
  const out = await ddb().send(new GetCommand({
    TableName: TABLES.Usage,
    Key: { subject, period },
  }));
  return (out.Item as UsageDoc) ?? { subject, period, questions: 0, tokens: 0, ttl: 0 };
}

export async function addUsage(subject: string, period: string, questions: number, tokens: number): Promise<UsageDoc> {
  const ttl = Math.floor(Date.now() / 1000) + 60 * 60 * 48; // 48h
  const out = await ddb().send(new UpdateCommand({
    TableName: TABLES.Usage,
    Key: { subject, period },
    UpdateExpression: 'ADD #q :q, #t :tk SET #ttl = :ttl',
    ExpressionAttributeNames: { '#q': 'questions', '#t': 'tokens', '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':q': questions, ':tk': tokens, ':ttl': ttl },
    ReturnValues: 'ALL_NEW',
  }));
  return out.Attributes as UsageDoc;
}
