'use client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import { getCsrf } from '@/lib/client/csrfClient';

export function SignupRequestForm({ onDone }: { onDone?: () => void } = {}) {
  const { t } = useTranslation();
  const [company, setCompany] = useState('');
  const [tokenLimit, setTokenLimit] = useState('1000');
  const [reqReason, setReqReason] = useState('');
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  const submit = async () => {
    try {
      const csrf = await getCsrf();
      const r = await fetch('/api/requestToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ company, tokenLimit: Number(tokenLimit), provider: 'ANY', ...(reqReason.trim() ? { reason: reqReason.trim() } : {}) }),
      });
      setStatus(r.ok ? 'ok' : 'error');
    } catch {
      setStatus('error'); // network / CSRF endpoint failure → surface to the user
    }
  };

  if (status === 'ok') {
    return (
      <SpaceBetween size="l">
        <Alert type="success">{t('tokenRequestSubmitted')}</Alert>
        <Button variant="primary" onClick={() => onDone?.()}>{t('close')}</Button>
      </SpaceBetween>
    );
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Form actions={<Button variant="primary" formAction="submit">{t('requestTokens')}</Button>}>
        <SpaceBetween size="l">
          {status === 'error' && <Alert type="error">{t('tokenRequestFailed')}</Alert>}
          <FormField label={t('company')}><Input value={company} onChange={({ detail }) => setCompany(detail.value)} /></FormField>
          <FormField label={t('tokensRequested')}><Input type="number" value={tokenLimit} onChange={({ detail }) => setTokenLimit(detail.value)} /></FormField>
          <FormField label={t('requestReason')} constraintText={t('requestReasonHint')}>
            <Input value={reqReason} onChange={({ detail }) => setReqReason(detail.value.slice(0, 100))} ariaLabel={t('requestReason')} />
          </FormField>
        </SpaceBetween>
      </Form>
    </form>
  );
}
