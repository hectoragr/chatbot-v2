'use client';
import { Auth0Provider } from '@auth0/nextjs-auth0';
import { I18nextProvider } from 'react-i18next';
import { useEffect, useState, type ReactNode } from 'react';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import i18n from '@/i18n/config';

export function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(Mode.Light);
  useEffect(() => {
    const saved = (localStorage.getItem('appearance') as Mode) || Mode.Light;
    setMode(saved);
    applyMode(saved);
  }, []);
  return (
    <Auth0Provider>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </Auth0Provider>
  );
}
