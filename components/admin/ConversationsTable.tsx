'use client';
import { useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ConversationDoc } from '@/lib/ddb';

export function ConversationsTable({ items, onRefresh }: { items: ConversationDoc[]; onRefresh?: () => void }) {
  void onRefresh;
  const [viewing, setViewing] = useState<ConversationDoc | null>(null);

  return (
    <>
      <Table
        header={<Header counter={`(${items.length})`}>Conversations</Header>}
        items={items}
        columnDefinitions={[
          {
            id: 'title',
            header: 'Title',
            cell: (c) => (
              <Button variant="inline-link" onClick={() => setViewing(c)}>
                {c.displayName}
              </Button>
            ),
          },
          { id: 'user', header: 'User', cell: (c) => c.user_id },
          { id: 'provider', header: 'Provider', cell: (c) => c.provider },
          { id: 'messages', header: 'Messages', cell: (c) => String(c.messages.length) },
          { id: 'updated', header: 'Updated', cell: (c) => new Date(c.updatedAt).toLocaleString() },
        ]}
        empty={<Box textAlign="center">No conversations</Box>}
        variant="container"
      />

      <Modal
        visible={!!viewing}
        onDismiss={() => setViewing(null)}
        header={viewing?.displayName ?? 'Conversation'}
        size="large"
      >
        <SpaceBetween size="s">
          {viewing?.messages.map((msg, i) => (
            <Box
              key={i}
              padding="s"
              variant="div"
            >
              <Box fontWeight="bold" color={msg.role === 'user' ? 'text-status-info' : 'text-status-success'}>
                {msg.role === 'user' ? '👤 User' : '🤖 Assistant'}
                <Box variant="span" color="text-status-inactive" fontSize="body-s"> · {new Date(msg.createdAt).toLocaleString()}</Box>
              </Box>
              <Box variant="p" padding={{ top: 'xxs' }}>
                {msg.content}
              </Box>
            </Box>
          ))}
          {!viewing?.messages.length && <Box color="text-status-inactive">No messages</Box>}
        </SpaceBetween>
      </Modal>
    </>
  );
}
