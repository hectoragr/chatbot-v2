import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n/config';
import { SettingsPanel } from '@/components/chat/SettingsPanel';

describe('SettingsPanel', () => {
  it('renders language and appearance controls', () => {
    render(<SettingsPanel />);
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
  });
});
