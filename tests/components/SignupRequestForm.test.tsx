import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n/config';
import { SignupRequestForm } from '@/components/auth/SignupRequestForm';

describe('SignupRequestForm', () => {
  it('renders company, tokens, and provider fields', () => {
    render(<SignupRequestForm />);
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Tokens requested')).toBeInTheDocument();
    expect(screen.getByText('Provider')).toBeInTheDocument();
  });

  it('replaces the form with a dismissible success message after submit', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/api/csrf')) return { ok: true, json: async () => ({ token: 'tok' }) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }));
    const onDone = vi.fn();
    render(<SignupRequestForm onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request tokens' }));
    await waitFor(() => expect(screen.getByText('Close')).toBeInTheDocument());
    expect(screen.queryByText('Company')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDone).toHaveBeenCalled();
  });
});
