import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n/config';
import { AdminDocsPanel } from '@/components/admin/AdminDocsPanel';
import type { AdminDocDoc } from '@/lib/ddb';

const docs: AdminDocDoc[] = [
  { doc_id: 'career', title: 'Career', topics: 'jobs, work', content: '# hi', updatedAt: '2026-07-02T00:00:00.000Z' },
];

describe('AdminDocsPanel', () => {
  it('lists docs and deletes one', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => (String(url).includes('csrf') ? { token: 'tok' } : { valid: true }) }) as Response));
    const onRefresh = vi.fn();
    render(<AdminDocsPanel docs={docs} onRefresh={onRefresh} />);
    expect(screen.getByText('Career')).toBeInTheDocument();
    expect(screen.getByText('jobs, work')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
