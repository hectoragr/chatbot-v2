'use client';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import type { ConversationDoc } from '@/lib/ddb';

export function ConversationsTable({ items, onRefresh }: { items: ConversationDoc[]; onRefresh?: () => void }) {
  void onRefresh;
  return (
    <Table
      header={<Header counter={`(${items.length})`}>Conversations</Header>}
      items={items}
      columnDefinitions={[
        { id: 'title', header: 'Title', cell: (c) => c.displayName },
        { id: 'user', header: 'User', cell: (c) => c.user_id },
        { id: 'provider', header: 'Provider', cell: (c) => c.provider },
        { id: 'messages', header: 'Messages', cell: (c) => String(c.messages.length) },
        { id: 'updated', header: 'Updated', cell: (c) => new Date(c.updatedAt).toLocaleString() },
      ]}
      empty={<Box textAlign="center">No conversations</Box>}
      variant="container"
    />
  );
}
