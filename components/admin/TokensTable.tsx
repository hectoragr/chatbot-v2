'use client';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
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
  return (
    <Table
      header={<Header counter={`(${items.length})`}>Tokens</Header>}
      items={items}
      columnDefinitions={[
        { id: 'token', header: 'Token', cell: (t) => t.token.slice(0, 8) + '…' },
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
  );
}
