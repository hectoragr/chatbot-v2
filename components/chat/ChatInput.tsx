'use client';
import { useState } from 'react';
import Textarea from '@cloudscape-design/components/textarea';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { ModelSelector } from './ModelSelector';
import { EmojiPickerButton } from './EmojiPickerButton';
import { QuotaBanner } from './QuotaBanner';
import type { QuotaStatusDTO } from '@/lib/client/api';

interface Props {
  provider: string;
  model: string;
  onModelChange: (id: string) => void;
  onSend: (message: string) => void;
  quota: QuotaStatusDTO;
}

export function ChatInput({ provider, model, onModelChange, onSend, quota }: Props) {
  const [value, setValue] = useState('');
  const disabled = quota.blocked;
  const submit = () => {
    if (disabled || value.trim() === '') return;
    onSend(value.trim());
    setValue('');
  };
  return (
    <SpaceBetween size="xs">
      <QuotaBanner quota={quota} />
      <SpaceBetween size="xs" direction="horizontal">
        <ModelSelector provider={provider} value={model} onChange={onModelChange} />
        <EmojiPickerButton disabled={disabled} onSelect={(e) => setValue((v) => v + e)} />
      </SpaceBetween>
      <Textarea
        value={value}
        disabled={disabled}
        onChange={({ detail }) => setValue(detail.value)}
        onKeyDown={({ detail }) => { if (detail.key === 'Enter' && !detail.shiftKey) submit(); }}
        placeholder="Type your message here..."
        rows={3}
      />
      <Button variant="primary" disabled={disabled} ariaLabel="Send" onClick={submit}>Send</Button>
    </SpaceBetween>
  );
}
