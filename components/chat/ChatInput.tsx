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
import FileUpload from '@cloudscape-design/components/file-upload';
import { ModelPicker } from './ModelPicker';
import { EmojiPickerButton } from './EmojiPickerButton';
import { QuotaBanner } from './QuotaBanner';
import type { QuotaStatusDTO } from '@/lib/client/api';

const MAX_FILES = 3;
const MAX_BYTES = 2 * 1024 * 1024;
// Images are base64-encoded before they travel to the server (~1.37x inflation),
// so a raw file cap is needed to keep the encoded payload under the server's
// 2MB per-attachment char cap (MAX_ATTACHMENT_CHARS in lib/attachments.ts).
const MAX_IMAGE_BYTES = Math.floor(1.4 * 1024 * 1024);
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

function kindOf(f: File): 'text' | 'json' | 'image' | null {
  if (IMAGE_MIMES.includes(f.type)) return 'image';
  if (f.name.endsWith('.json')) return 'json';
  if (f.name.endsWith('.txt') || f.type === 'text/plain') return 'text';
  return null;
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

interface Props {
  provider: string;
  model: string;
  onModelChange: (provider: string, modelId: string) => void;
  onSend: (
    message: string,
    extra?: { captchaAnswer?: string; attachments?: { name: string; kind: string; content: string }[] },
  ) => Promise<boolean | void> | boolean | void;
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
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const disabled = quota.blocked;
  const submit = async () => {
    if (sending || disabled || value.trim() === '') return;
    setFileError(null);
    setSending(true);
    try {
      const attachments: { name: string; kind: string; content: string }[] = [];
      for (const f of files.slice(0, MAX_FILES)) {
        const kind = kindOf(f);
        if (!kind) { setFileError(t('attachInvalid')); return; }
        const byteCap = kind === 'image' ? MAX_IMAGE_BYTES : MAX_BYTES;
        if (f.size > byteCap) { setFileError(t('attachInvalid')); return; }
        const content = kind === 'image' ? await readAsDataUrl(f) : await f.text();
        if (kind === 'json') {
          try { JSON.parse(content); } catch { setFileError(t('attachInvalid')); return; }
        }
        attachments.push({ name: f.name, kind, content });
      }
      const ok = await onSend(value.trim(), {
        ...(contact?.active && contact.anon ? { captchaAnswer } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
      if (ok === false) return;
      setValue('');
      setCaptchaAnswer('');
      setFiles([]);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (contact?.active) {
      setValue((v) => (v.trim() === '' ? t('contactTemplate') : v));
    } else {
      // Leaving contact mode (cancel): only clear the composer if the user
      // never touched the auto-filled template — otherwise a drafted message
      // would be silently wiped out from under them.
      setValue((v) => (v === t('contactTemplate') ? '' : v));
    }
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
      {!contact?.active && (
        <FileUpload
          value={files}
          onChange={({ detail }) => { setFiles(detail.value.slice(0, MAX_FILES)); setFileError(null); }}
          multiple
          accept=".txt,.json,image/png,image/jpeg,image/gif,image/webp"
          constraintText={t('attachHint')}
          errorText={fileError ?? undefined}
          showFileSize
          i18nStrings={{
            uploadButtonText: () => t('attachFiles'),
            dropzoneText: () => t('attachFiles'),
            removeFileAriaLabel: (i) => `${t('attachFiles')} ${i + 1}`,
          }}
        />
      )}
      <Button variant="primary" disabled={disabled} loading={sending} ariaLabel={t('send')} onClick={submit}>{t('send')}</Button>
    </SpaceBetween>
  );
}
