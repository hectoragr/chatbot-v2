import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n/config';
import { SignupRequestForm } from '@/components/auth/SignupRequestForm';

describe('SignupRequestForm', () => {
  it('renders company and tokens fields', () => {
    render(<SignupRequestForm />);
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Tokens requested')).toBeInTheDocument();
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

  it('has no provider selector and submits ANY', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('csrf')) return { ok: true, json: async () => ({ token: 'tok' }) } as Response;
      if (init) calls.push(init);
      return { ok: true, json: async () => ({}) } as Response;
    }));
    render(<SignupRequestForm />);
    expect(screen.queryByText('Provider')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request tokens' }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(JSON.parse(String(calls[0].body)).provider).toBe('ANY');
  });

  it('submits the reason field', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('csrf')) return { ok: true, json: async () => ({ token: 'tok' }) } as Response;
      if (init) calls.push(init);
      return { ok: true, json: async () => ({}) } as Response;
    }));
    render(<SignupRequestForm />);
    const reasonInput = screen.getByLabelText(/reason/i);
    fireEvent.change(reasonInput, { target: { value: 'testing the api' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request tokens' }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(JSON.parse(String(calls[0].body)).reason).toBe('testing the api');
  });
});
