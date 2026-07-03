import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n/config';
import { SettingsPanel } from '@/components/chat/SettingsPanel';

describe('SettingsPanel', () => {
  it('renders language and appearance controls', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
  });

  it('lists dynamic locales from the server in the language dropdown', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/locales')) {
        return { ok: true, status: 200, json: async () => ({ locales: [{ lang: 'ar', name: 'العربية', rtl: true }] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }));
    render(<SettingsPanel authenticated />);
    // Cloudscape's Select trigger opens on mousedown (it calls preventDefault
    // to avoid a focus/blur race), not on click, so a click event alone never
    // opens the dropdown here.
    fireEvent.mouseDown(screen.getAllByRole('button')[0]); // open language Select
    await waitFor(() => expect(screen.getByText('العربية')).toBeInTheDocument());
    expect(screen.getByText('Add language…')).toBeInTheDocument();
  });
});
