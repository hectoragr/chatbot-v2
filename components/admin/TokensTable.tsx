'use client';
import { useState } from 'react';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { getCsrf } from '@/lib/client/csrfClient';
import type { TokenDoc } from '@/lib/ddb';

async function toggle(token: string, isActive: boolean, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/tokens/${encodeURIComponent(token)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ isActive: !isActive }),
  });
  onRefresh();
}

async function del(token: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/tokens/${encodeURIComponent(token)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
  onRefresh();
}

export function TokensTable({ items, onRefresh }: { items: TokenDoc[]; onRefresh: () => void }) {
  const [urlToken, setUrlToken] = useState<string | null>(null);
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <>
      <Table
        header={<Header counter={`(${items.length})`}>Tokens</Header>}
        items={items}
        columnDefinitions={[
          {
            id: 'token',
            header: 'Token',
            cell: (t) => (
              <Button variant="inline-link" onClick={() => setUrlToken(t.token)}>
                {t.token.slice(0, 8)}…
              </Button>
            ),
          },
          { id: 'user', header: 'User', cell: (t) => t.user_id },
          { id: 'provider', header: 'Provider', cell: (t) => t.provider },
          { id: 'usage', header: 'Usage', cell: (t) => `${t.used}/${t.limit}` },
          { id: 'active', header: 'Active', cell: (t) => (t.isActive ? 'Yes' : 'No') },
          {
            id: 'actions',
            header: '',
            cell: (t) => (
              <>
                <Button variant="inline-link" onClick={() => toggle(t.token, t.isActive, onRefresh)}>
                  Toggle
                </Button>
                {' '}
                <Button variant="inline-link" onClick={() => del(t.token, onRefresh)}>
                  Delete
                </Button>
              </>
            ),
          },
        ]}
        empty={<Box textAlign="center">No tokens</Box>}
        variant="container"
      />

      <Modal
        visible={!!urlToken}
        onDismiss={() => setUrlToken(null)}
        header="Token Access URL"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => { navigator.clipboard.writeText(`${appUrl}?token=${urlToken}`); }}>
                Copy URL
              </Button>
              <Button variant="primary" onClick={() => setUrlToken(null)}>Close</Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box>Share this URL with the token holder:</Box>
          <Box variant="code">
            {appUrl}?token={urlToken}
          </Box>
        </SpaceBetween>
      </Modal>
    </>
  );
}
