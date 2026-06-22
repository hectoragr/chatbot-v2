'use client';
import { useTranslation } from 'react-i18next';
import Select from '@cloudscape-design/components/select';
import FormField from '@cloudscape-design/components/form-field';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Modal from '@cloudscape-design/components/modal';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import { applyMode, Mode } from '@cloudscape-design/global-styles';
import { useState, useEffect } from 'react';
import { getCsrf } from '@/lib/client/csrfClient';

const LANGS = [
  { label: 'English', value: 'en' }, { label: 'Español', value: 'es' },
  { label: 'Français', value: 'fr' }, { label: 'Deutsch', value: 'de' },
];

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
  const [theme, setTheme] = useState('light');
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'pending' | 'done' | 'error' | 'submitted'>('idle');
  const lang = LANGS.find((l) => l.value === i18n.language) ?? LANGS[0];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = localStorage.getItem('appearance') || 'light';
    setTheme(saved);
    applyTheme(saved);
  }, []);

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
      <SpaceBetween size="l">
        <FormField label={t('language')}>
          <Select selectedOption={lang} options={LANGS}
            onChange={({ detail }) => i18n.changeLanguage(detail.selectedOption.value!)} />
        </FormField>
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
