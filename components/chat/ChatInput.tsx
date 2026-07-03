'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Textarea from '@cloudscape-design/components/textarea';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import { ModelPicker } from './ModelPicker';
import { EmojiPickerButton } from './EmojiPickerButton';
import { QuotaBanner } from './QuotaBanner';
import type { QuotaStatusDTO } from '@/lib/client/api';

interface Props {
  provider: string;
  model: string;
  onModelChange: (provider: string, modelId: string) => void;
  onSend: (message: string, extra?: { captchaAnswer?: string }) => void;
  quota: QuotaStatusDTO;
  pendingApproval?: boolean;
  providerRemaining?: Record<string, number>;
  lastAutoModel?: string | null;
  contact?: { active: boolean; anon: boolean; question: string | null; onCancel: () => void };
}

export function ChatInput({ model, onModelChange, onSend, quota, pendingApproval, providerRemaining, lastAutoModel, contact }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const disabled = quota.blocked;
  const submit = () => {
    if (disabled || value.trim() === '') return;
    onSend(value.trim(), contact?.active && contact.anon ? { captchaAnswer } : undefined);
    setValue('');
    setCaptchaAnswer('');
  };

  useEffect(() => {
    if (contact?.active) setValue((v) => (v.trim() === '' ? t('contactTemplate') : v));
  }, [contact?.active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SpaceBetween size="xs">
      <QuotaBanner quota={quota} pendingApproval={pendingApproval} providerRemaining={providerRemaining} />
      {contact?.active && (
        <Alert type="info" dismissible onDismiss={contact.onCancel}>{t('contactModeHint')}</Alert>
      )}
      {contact?.active && contact.anon && contact.question && (
        <FormField label={t('captchaLabel', { question: contact.question })}>
          <Input value={captchaAnswer} onChange={({ detail }) => setCaptchaAnswer(detail.value)} placeholder="?" inputMode="numeric" />
        </FormField>
      )}
      {!contact?.active && (
        <SpaceBetween size="xs" direction="horizontal" alignItems="center">
          <ModelPicker modelId={model} onChange={onModelChange} providerRemaining={providerRemaining} />
          <EmojiPickerButton disabled={disabled} onSelect={(e) => setValue((v) => v + e)} />
          {model === 'auto' && lastAutoModel && (
            <Box fontSize="body-s" color="text-status-inactive">{t('answeredBy', { model: lastAutoModel })}</Box>
          )}
        </SpaceBetween>
      )}
      <Textarea
        value={value}
        disabled={disabled}
        onChange={({ detail }) => setValue(detail.value)}
        onKeyDown={({ detail }) => { if (detail.key === 'Enter' && !detail.shiftKey) submit(); }}
        placeholder={t('typeMessage')}
        rows={3}
      />
      <Button variant="primary" disabled={disabled} ariaLabel={t('send')} onClick={submit}>{t('send')}</Button>
    </SpaceBetween>
  );
}
