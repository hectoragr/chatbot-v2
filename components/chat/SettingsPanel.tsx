'use client';
import { useTranslation } from 'react-i18next';
import Select from '@cloudscape-design/components/select';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { useState } from 'react';

const LANGS = [
  { label: 'English', value: 'en' }, { label: 'Español', value: 'es' },
  { label: 'Français', value: 'fr' }, { label: 'Deutsch', value: 'de' },
];

export function SettingsPanel() {
  const { i18n } = useTranslation();
  const [mode, setMode] = useState<string>(typeof window !== 'undefined' ? (localStorage.getItem('appearance') || 'light') : 'light');
  const lang = LANGS.find((l) => l.value === i18n.language) ?? LANGS[0];
  return (
    <SpaceBetween size="l">
      <FormField label="Language">
        <Select selectedOption={lang} options={LANGS}
          onChange={({ detail }) => i18n.changeLanguage(detail.selectedOption.value!)} />
      </FormField>
      <FormField label="Appearance">
        <Select
          selectedOption={{ label: mode === 'dark' ? 'Dark' : 'Light', value: mode }}
          options={[{ label: 'Light', value: 'light' }, { label: 'Dark', value: 'dark' }]}
          onChange={({ detail }) => {
            const v = detail.selectedOption.value!;
            setMode(v);
            applyMode(v === 'dark' ? Mode.Dark : Mode.Light);
            localStorage.setItem('appearance', v);
          }}
        />
      </FormField>
    </SpaceBetween>
  );
}
