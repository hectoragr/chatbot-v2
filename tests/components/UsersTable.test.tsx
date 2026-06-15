import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UsersTable } from '@/components/admin/UsersTable';

describe('UsersTable', () => {
  it('renders user rows', () => {
    render(<UsersTable users={[{ user_id: 'a@b.com', email: 'a@b.com', name: 'Alice', company: 'Acme', createdAt: '', updatedAt: '' }]} onRefresh={() => {}} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});
