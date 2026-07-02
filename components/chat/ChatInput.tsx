'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Textarea from '@cloudscape-design/components/textarea';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import { ModelPicker } from './ModelPicker';
import { EmojiPickerButton } from './EmojiPickerButton';
import { QuotaBanner } from './QuotaBanner';
import type { QuotaStatusDTO } from '@/lib/client/api';

interface Props {
  provider: string;
  model: string;
  onModelChange: (provider: string, modelId: string) => void;
  onSend: (message: string) => void;
  quota: QuotaStatusDTO;
  pendingApproval?: boolean;
  providerRemaining?: Record<string, number>;
  lastAutoModel?: string | null;
}

export function ChatInput({ model, onModelChange, onSend, quota, pendingApproval, providerRemaining, lastAutoModel }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const disabled = quota.blocked;
  const submit = () => {
    if (disabled || value.trim() === '') return;
    onSend(value.trim());
    setValue('');
  };
  return (
    <SpaceBetween size="xs">
      <QuotaBanner quota={quota} pendingApproval={pendingApproval} providerRemaining={providerRemaining} />
      <SpaceBetween size="xs" direction="horizontal" alignItems="center">
        <ModelPicker modelId={model} onChange={onModelChange} providerRemaining={providerRemaining} />
        <EmojiPickerButton disabled={disabled} onSelect={(e) => setValue((v) => v + e)} />
        {model === 'auto' && lastAutoModel && (
          <Box fontSize="body-s" color="text-status-inactive">{t('answeredBy', { model: lastAutoModel })}</Box>
        )}
      </SpaceBetween>
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
