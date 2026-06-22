'use client';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { getCsrf } from '@/lib/client/csrfClient';
import type { UserDoc } from '@/lib/ddb';

async function del(email: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
  onRefresh();
}

async function toggleApproved(email: string, approved: boolean, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ approved: !approved }),
  });
  onRefresh();
}

async function purge(email: string, onRefresh: () => void) {
  if (!confirm(`Permanently delete ALL data for ${email}? This cannot be undone.`)) return;
  const csrf = await getCsrf();
  await fetch(`/api/admin/users/${encodeURIComponent(email)}/purge`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
  onRefresh();
}

export function UsersTable({ users, onRefresh }: { users: UserDoc[]; onRefresh: () => void }) {
  return (
    <Table
      header={<Header counter={`(${users.length})`}>Users</Header>}
      items={users}
      columnDefinitions={[
        { id: 'email', header: 'Email', cell: (u) => u.email ?? u.user_id },
        { id: 'name', header: 'Name', cell: (u) => u.name ?? '' },
        { id: 'company', header: 'Company', cell: (u) => u.company ?? '' },
        { id: 'approved', header: 'Approved', cell: (u) => (u.approved ? 'Yes' : 'No') },
        {
          id: 'status',
          header: 'Status',
          cell: (u) => u.pendingDelete
            ? <StatusIndicator type="warning">Pending deletion</StatusIndicator>
            : <StatusIndicator type="success">Active</StatusIndicator>,
        },
        {
          id: 'actions',
          header: '',
          cell: (u) => (
            <>
              <Button variant="inline-link" onClick={() => toggleApproved(u.user_id, !!u.approved, onRefresh)}>
                {u.approved ? 'Unapprove' : 'Approve'}
              </Button>
              {' '}
              <Button variant="inline-link" onClick={() => del(u.user_id, onRefresh)}>Delete</Button>
              {u.pendingDelete && (
                <>
                  {' '}
                  <Button variant="inline-link" onClick={() => purge(u.user_id, onRefresh)}>
                    Approve &amp; Purge
                  </Button>
                </>
              )}
            </>
          ),
        },
      ]}
      empty={<Box textAlign="center">No users</Box>}
      variant="container"
    />
  );
}
