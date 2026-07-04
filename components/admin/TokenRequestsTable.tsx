'use client';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import { getCsrf } from '@/lib/client/csrfClient';
import type { TokenRequestDoc } from '@/lib/ddb';

async function approve(token: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/approveToken/${encodeURIComponent(token)}`, { method: 'PUT', headers: { 'X-CSRF-Token': csrf } });
  onRefresh();
}

async function deny(token: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/denyToken/${encodeURIComponent(token)}`, { method: 'PUT', headers: { 'X-CSRF-Token': csrf } });
  onRefresh();
}

async function blockIp(ip: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch('/api/admin/blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ subject: `ip:${ip}`, reason: 'blocked from token requests' }),
  });
  onRefresh();
}

export function TokenRequestsTable({ items, onRefresh }: { items: TokenRequestDoc[]; onRefresh: () => void }) {
  return (
    <Table
      header={<Header counter={`(${items.length})`}>Token Requests</Header>}
      items={items}
      columnDefinitions={[
        { id: 'email', header: 'Email', cell: (r) => r.user_id },
        { id: 'name', header: 'Name', cell: (r) => r.name },
        { id: 'company', header: 'Company', cell: (r) => r.company ?? '' },
        { id: 'reason', header: 'Reason', cell: (r) => r.reason ?? '' },
        { id: 'ip', header: 'IP', cell: (r) => r.ip ?? '' },
        { id: 'provider', header: 'Provider', cell: (r) => r.provider },
        { id: 'limit', header: 'Limit', cell: (r) => String(r.limit) },
        { id: 'requested', header: 'Requested', cell: (r) => new Date(r.createdAt).toLocaleString() },
        {
          id: 'actions',
          header: '',
          cell: (r) => (
            <>
              <Button variant="inline-link" onClick={() => approve(r.token, onRefresh)}>
                Approve
              </Button>
              {' '}
              <Button variant="inline-link" onClick={() => deny(r.token, onRefresh)}>
                Deny
              </Button>
              {r.ip && (
                <>
                  {' '}
                  <Button variant="inline-link" onClick={() => blockIp(r.ip!, onRefresh)}>
                    Block IP
                  </Button>
                </>
              )}
            </>
          ),
        },
      ]}
      empty={<Box textAlign="center">No token requests</Box>}
      variant="container"
    />
  );
}
