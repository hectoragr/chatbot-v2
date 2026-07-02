'use client';
import { Auth0Provider } from '@auth0/nextjs-auth0';
import { I18nextProvider } from 'react-i18next';
import { useEffect, type ReactNode } from 'react';
import { applyMode, applyDensity, Density, Mode } from '@cloudscape-design/global-styles';
import i18n from '@/i18n/config';

const LIGHT_THEMES = ['light', 'solarized-light'];

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    const saved = localStorage.getItem('appearance') || 'dark';
    applyMode(LIGHT_THEMES.includes(saved) ? Mode.Light : Mode.Dark);
    applyDensity(Density.Compact);
  }, []);
  return (
    <Auth0Provider>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Auth0Provider>
  );
}
