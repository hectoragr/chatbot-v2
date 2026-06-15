'use client';
import { useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { getCsrf } from '@/lib/client/csrfClient';
import type { BlockDoc } from '@/lib/ddb';

async function unblock(subject: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/blocks?subject=${encodeURIComponent(subject)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
  onRefresh();
}

async function addBlock(subject: string, reason: string, onRefresh: () => void, clearInputs: () => void) {
  const csrf = await getCsrf();
  await fetch('/api/admin/blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ subject, reason }),
  });
  onRefresh();
  clearInputs();
}

export function BlocksTable({ items, onRefresh }: { items: BlockDoc[]; onRefresh: () => void }) {
  const [subject, setSubject] = useState('');
  const [reason, setReason] = useState('');

  const clearInputs = () => {
    setSubject('');
    setReason('');
  };

  return (
    <Table
      header={
        <Header
          counter={`(${items.length})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Input
                value={subject}
                onChange={({ detail }) => setSubject(detail.value)}
                placeholder="user:email or ip:1.2.3.4"
              />
              <Input
                value={reason}
                onChange={({ detail }) => setReason(detail.value)}
                placeholder="Reason"
              />
              <Button onClick={() => addBlock(subject, reason, onRefresh, clearInputs)} disabled={!subject || !reason}>
                Block
              </Button>
            </SpaceBetween>
          }
        >
          Blocks
        </Header>
      }
      items={items}
      columnDefinitions={[
        { id: 'subject', header: 'Subject', cell: (b) => b.subject },
        { id: 'reason', header: 'Reason', cell: (b) => b.reason },
        { id: 'source', header: 'Source', cell: (b) => b.source },
        { id: 'created', header: 'Created', cell: (b) => new Date(b.createdAt).toLocaleString() },
        { id: 'expires', header: 'Expires', cell: (b) => (b.ttl ? new Date(b.ttl * 1000).toLocaleString() : 'Never') },
        {
          id: 'actions',
          header: '',
          cell: (b) => (
            <Button variant="inline-link" onClick={() => unblock(b.subject, onRefresh)}>
              Unblock
            </Button>
          ),
        },
      ]}
      empty={<Box textAlign="center">No blocks</Box>}
      variant="container"
    />
  );
}
