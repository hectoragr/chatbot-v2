'use client';
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import { UsersTable } from '@/components/admin/UsersTable';
import { TokensTable } from '@/components/admin/TokensTable';
import { ConversationsTable } from '@/components/admin/ConversationsTable';
import { TokenRequestsTable } from '@/components/admin/TokenRequestsTable';
import { BlocksTable } from '@/components/admin/BlocksTable';
import type { UserDoc, TokenDoc, ConversationDoc, TokenRequestDoc, BlockDoc } from '@/lib/ddb';

interface AdminTables {
  users?: UserDoc[];
  tokens?: TokenDoc[];
  conversations?: ConversationDoc[];
  unprocessedTokens?: TokenRequestDoc[];
  blocks?: BlockDoc[];
}

export default function AdminPage() {
  const [tables, setTables] = useState<AdminTables | null>(null);
  const load = useCallback(async () => {
    const r = await fetch('/api/admin/tables');
    const data = await r.json();
    setTables(data.tables ?? {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (!tables) return <Spinner />;
  return (
    <ContentLayout header={<Header variant="h1">Admin</Header>}>
      <SpaceBetween size="l">
        <TokenRequestsTable items={tables.unprocessedTokens ?? []} onRefresh={load} />
        <UsersTable users={tables.users ?? []} onRefresh={load} />
        <TokensTable items={tables.tokens ?? []} onRefresh={load} />
        <BlocksTable items={tables.blocks ?? []} onRefresh={load} />
        <ConversationsTable items={tables.conversations ?? []} />
      </SpaceBetween>
    </ContentLayout>
  );
}
