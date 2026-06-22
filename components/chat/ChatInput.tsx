'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Textarea from '@cloudscape-design/components/textarea';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
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
}

export function ChatInput({ model, onModelChange, onSend, quota, pendingApproval, providerRemaining }: Props) {
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
      <SpaceBetween size="xs" direction="horizontal">
        <ModelPicker modelId={model} onChange={onModelChange} providerRemaining={providerRemaining} />
        <EmojiPickerButton disabled={disabled} onSelect={(e) => setValue((v) => v + e)} />
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
