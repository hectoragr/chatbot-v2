'use client';
import { useEffect, useState, useCallback } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import Alert from '@cloudscape-design/components/alert';
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
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/tables');
      if (!r.ok) throw new Error(`Failed to load admin tables (${r.status})`);
      const data = await r.json();
      setTables(data.tables ?? {});
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (error) return <Alert type="error" header="Could not load admin data">{error}</Alert>;
  if (!tables) return <Spinner />;
  return (
    <div className="admin-content">
      <ContentLayout header={<Header variant="h1">Admin</Header>}>
        <SpaceBetween size="xl">
          <TokenRequestsTable items={tables.unprocessedTokens ?? []} onRefresh={load} />
          <UsersTable users={tables.users ?? []} onRefresh={load} />
          <TokensTable items={tables.tokens ?? []} onRefresh={load} />
          <BlocksTable items={tables.blocks ?? []} onRefresh={load} />
          <ConversationsTable items={tables.conversations ?? []} />
        </SpaceBetween>
      </ContentLayout>
    </div>
  );
}
