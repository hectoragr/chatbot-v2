import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n/config';
import { TokenRequestsTable } from '@/components/admin/TokenRequestsTable';
import type { TokenRequestDoc } from '@/lib/ddb';

const req = {
  token: 't1', user_id: 'a@b.c', name: 'Alice', processed: false,
  createdAt: '2026-07-03T00:00:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z',
  provider: 'ANY', limit: 1000, company: 'Acme',
  reason: 'demo access', ip: '10.1.2.3',
} as TokenRequestDoc;

describe('TokenRequestsTable', () => {
  it('shows reason, ip, and a Block IP action', () => {
    render(<TokenRequestsTable items={[req]} onRefresh={vi.fn()} />);
    expect(screen.getByText('demo access')).toBeInTheDocument();
    expect(screen.getByText('10.1.2.3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /block ip/i })).toBeInTheDocument();
  });
});
