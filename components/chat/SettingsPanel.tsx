'use client';
import { useTranslation } from 'react-i18next';
import Select from '@cloudscape-design/components/select';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Input from '@cloudscape-design/components/input';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { useState, useEffect } from 'react';
import { getCsrf } from '@/lib/client/csrfClient';

const LANGS = [
  { label: 'English', value: 'en' }, { label: 'Español', value: 'es' },
  { label: 'Français', value: 'fr' }, { label: 'Deutsch', value: 'de' },
];

const ADD_VALUE = '__add__';

function applyDir(rtl: boolean, lang: string) {
  document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

const THEMES = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'Matrix', value: 'matrix' },
  { label: 'Tokyo Night', value: 'tokyo-night' },
  { label: 'Solarized Dark', value: 'solarized-dark' },
  { label: 'Solarized Light', value: 'solarized-light' },
];

function applyTheme(theme: string) {
  // Custom themes use data-theme attribute + dark mode base
  const customThemes = ['matrix', 'tokyo-night', 'solarized-dark', 'solarized-light'];
  if (customThemes.includes(theme)) {
    applyMode(theme === 'solarized-light' ? Mode.Light : Mode.Dark);
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
    applyMode(theme === 'dark' ? Mode.Dark : Mode.Light);
  }
  localStorage.setItem('appearance', theme);
}

export function SettingsPanel({ authenticated }: { authenticated?: boolean }) {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState('dark');
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'pending' | 'done' | 'error' | 'submitted'>('idle');
  const [dynamicLocales, setDynamicLocales] = useState<{ lang: string; name: string; rtl: boolean }[]>([]);
  const [addingLang, setAddingLang] = useState(false);
  const [langInput, setLangInput] = useState('');
  const [langStatus, setLangStatus] = useState<'idle' | 'pending' | 'error'>('idle');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('appearance') || 'dark';
    setTheme(saved);
    applyTheme(saved);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/locales');
        const d = await r.json();
        if (!Array.isArray(d.locales)) return;
        setDynamicLocales(d.locales);

        // Restore dynamic-locale bundle + RTL direction for a returning user
        // whose language (persisted by i18next in localStorage) is a
        // dynamic, non-built-in locale that isn't loaded into memory yet.
        const current = d.locales.find((l: { lang: string; name: string; rtl: boolean }) => l.lang === i18n.language);
        if (current) {
          if (!i18n.hasResourceBundle(i18n.language, 'translation')) {
            const lr = await fetch(`/api/locales/${encodeURIComponent(i18n.language)}`);
            if (lr.ok) {
              const { locale } = await lr.json();
              i18n.addResourceBundle(i18n.language, 'translation', locale.translations);
            }
          }
          await i18n.changeLanguage(i18n.language);
          applyDir(current.rtl, i18n.language);
        }
      } catch {
        // never break settings panel render
      }
    })();
  }, [i18n]);

  const langOptions = [
    ...LANGS,
    ...dynamicLocales.map((l) => ({ label: l.name, value: l.lang })),
    ...(authenticated ? [{ label: t('addLanguage'), value: ADD_VALUE }] : []),
  ];
  const selectedLang = langOptions.find((l) => l.value === i18n.language) ?? LANGS[0];

  const switchLanguage = async (value: string) => {
    if (value === ADD_VALUE) { setAddingLang(true); return; }
    const dyn = dynamicLocales.find((l) => l.lang === value);
    if (dyn && !i18n.hasResourceBundle(value, 'translation')) {
      const r = await fetch(`/api/locales/${encodeURIComponent(value)}`);
      if (!r.ok) return;
      const { locale } = await r.json();
      i18n.addResourceBundle(value, 'translation', locale.translations);
    }
    await i18n.changeLanguage(value);
    applyDir(dyn?.rtl ?? false, value);
  };

  const submitNewLanguage = async () => {
    setLangStatus('pending');
    try {
      const csrf = await getCsrf();
      const r = await fetch('/api/locales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ language: langInput }),
      });
      if (!r.ok) { setLangStatus('error'); return; }
      const { locale } = await r.json();
      i18n.addResourceBundle(locale.lang, 'translation', locale.translations);
      setDynamicLocales((ls) => ls.some((l) => l.lang === locale.lang) ? ls : [...ls, { lang: locale.lang, name: locale.name, rtl: locale.rtl }]);
      await i18n.changeLanguage(locale.lang);
      applyDir(locale.rtl, locale.lang);
      setAddingLang(false); setLangInput(''); setLangStatus('idle');
    } catch { setLangStatus('error'); }
  };

  const requestDeletion = async () => {
    setDeleteStatus('pending');
    try {
      const csrf = await getCsrf();
      const r = await fetch('/api/me/deletion-request', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrf },
      });
      setDeleteStatus(r.ok ? 'submitted' : 'error');
    } catch {
      setDeleteStatus('error');
    }
  };

  return (
    <>
      <Box padding={{ horizontal: 's', vertical: 's' }}>
        <SpaceBetween size="l">
          <FormField label={t('language')}>
            <Select selectedOption={selectedLang} options={langOptions}
              onChange={({ detail }) => switchLanguage(detail.selectedOption.value!)} />
          </FormField>
          {addingLang && (
            <FormField label={t('addLanguagePrompt')} errorText={langStatus === 'error' ? t('languageAddFailed') : undefined}>
              <SpaceBetween size="xs" direction="horizontal">
                <Input value={langInput} onChange={({ detail }) => setLangInput(detail.value)} />
                <Button variant="primary" loading={langStatus === 'pending'} onClick={submitNewLanguage}>{t('send')}</Button>
                <Button variant="link" onClick={() => { setAddingLang(false); setLangStatus('idle'); }}>{t('cancel')}</Button>
              </SpaceBetween>
            </FormField>
          )}
          <FormField label={t('appearance')}>
            <Select
              selectedOption={THEMES.find((th) => th.value === theme) ?? THEMES[0]}
              options={THEMES}
              onChange={({ detail }) => {
                const v = detail.selectedOption.value!;
                setTheme(v);
                applyTheme(v);
              }}
            />
          </FormField>
          {authenticated && (
            <FormField label={t('account')}>
              <Button variant="normal" onClick={() => setDeleteModal(true)}>
                {t('requestAccountDeletion')}
              </Button>
            </FormField>
          )}
        </SpaceBetween>
      </Box>

      <Modal
        visible={deleteModal}
        onDismiss={() => { setDeleteModal(false); setDeleteStatus('idle'); }}
        header={t('deleteAccount')}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() => { setDeleteModal(false); setDeleteStatus('idle'); }}>{t('cancel')}</Button>
              {deleteStatus !== 'submitted' && (
                <Button
                  variant="primary"
                  loading={deleteStatus === 'pending'}
                  onClick={requestDeletion}
                >
                  {t('confirmDeletionRequest')}
                </Button>
              )}
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {deleteStatus === 'idle' && (
            <Alert type="warning" header={t('permanentOperation')}>
              {t('deletionWarningBody')}
            </Alert>
          )}
          {deleteStatus === 'submitted' && (
            <Alert type="success" header={t('requestSubmitted')}>
              {t('deletionRequestSubmittedBody')}
            </Alert>
          )}
          {deleteStatus === 'error' && (
            <Alert type="error">{t('deletionRequestFailed')}</Alert>
          )}
        </SpaceBetween>
      </Modal>
    </>
  );
}
