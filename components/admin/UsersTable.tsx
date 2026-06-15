'use client';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Button from '@cloudscape-design/components/button';
import { getCsrf } from '@/lib/client/csrfClient';
import type { UserDoc } from '@/lib/ddb';

async function del(email: string, onRefresh: () => void) {
  const csrf = await getCsrf();
  await fetch(`/api/admin/users/${encodeURIComponent(email)}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrf } });
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
        { id: 'actions', header: '', cell: (u) => <Button variant="inline-link" onClick={() => del(u.user_id, onRefresh)}>Delete</Button> },
      ]}
      empty={<Box textAlign="center">No users</Box>}
      variant="container"
    />
  );
}
