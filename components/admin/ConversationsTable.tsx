'use client';
import { useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import MarkdownMessage from '@/components/chat/MarkdownMessage';
import type { ConversationDoc } from '@/lib/ddb';
import { conversationToMarkdown, conversationToJson, safeFilename, downloadFile } from '@/lib/client/exportConversation';

export function ConversationsTable({ items, onRefresh }: { items: ConversationDoc[]; onRefresh?: () => void }) {
  void onRefresh;
  const [viewing, setViewing] = useState<ConversationDoc | null>(null);

  const exportConvo = (c: ConversationDoc, format: string) => {
    const convo = { displayName: c.displayName, messages: c.messages };
    if (format === 'md') downloadFile(`${safeFilename(c.displayName)}.md`, conversationToMarkdown(convo), 'text/markdown');
    else downloadFile(`${safeFilename(c.displayName)}.json`, conversationToJson(convo), 'application/json');
  };

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
          {
            id: 'actions',
            header: 'Actions',
            cell: (c) => (
              <ButtonDropdown
                variant="inline-icon"
                ariaLabel={`Export ${c.displayName}`}
                items={[{ id: 'md', text: 'Export Markdown (.md)' }, { id: 'json', text: 'Export JSON (.json)' }]}
                onItemClick={({ detail }) => exportConvo(c, detail.id)}
              />
            ),
          },
        ]}
        empty={<Box textAlign="center">No conversations</Box>}
        variant="container"
      />

      <Modal
        visible={!!viewing}
        onDismiss={() => setViewing(null)}
        header={viewing?.displayName ?? 'Conversation'}
        size="max"
        footer={viewing && (
          <ButtonDropdown
            items={[{ id: 'md', text: 'Export Markdown (.md)' }, { id: 'json', text: 'Export JSON (.json)' }]}
            onItemClick={({ detail }) => exportConvo(viewing, detail.id)}
          >
            Export
          </ButtonDropdown>
        )}
      >
        <SpaceBetween size="s">
          {viewing?.messages.map((msg, i) => (
            <MarkdownMessage
              key={i}
              content={msg.content}
              type={msg.role === 'user' ? 'prompt' : 'response'}
              timestamp={new Date(msg.createdAt).toLocaleString()}
            />
          ))}
          {!viewing?.messages.length && <Box color="text-status-inactive">No messages</Box>}
        </SpaceBetween>
      </Modal>
    </>
  );
}
