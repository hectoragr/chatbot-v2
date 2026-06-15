'use client';
import { useState } from 'react';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import { getCsrf } from '@/lib/client/csrfClient';

const PROVIDERS = [{ label: 'OpenAI', value: 'OPENAI' }, { label: 'DeepSeek', value: 'DEEPSEEK' }, { label: 'All', value: 'ANY' }];

export function SignupRequestForm() {
  const [company, setCompany] = useState('');
  const [tokenLimit, setTokenLimit] = useState('1000');
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  const submit = async () => {
    try {
      const csrf = await getCsrf();
      const r = await fetch('/api/requestToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ company, tokenLimit: Number(tokenLimit), provider: provider.value }),
      });
      setStatus(r.ok ? 'ok' : 'error');
    } catch {
      setStatus('error'); // network / CSRF endpoint failure → surface to the user
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Form actions={<Button variant="primary" formAction="submit">Request tokens</Button>}>
        <SpaceBetween size="l">
          {status === 'ok' && <Alert type="success">Request submitted for admin approval.</Alert>}
          {status === 'error' && <Alert type="error">Could not submit request. You may have reached the maximum of 3 token requests.</Alert>}
          <FormField label="Company"><Input value={company} onChange={({ detail }) => setCompany(detail.value)} /></FormField>
          <FormField label="Tokens requested"><Input type="number" value={tokenLimit} onChange={({ detail }) => setTokenLimit(detail.value)} /></FormField>
          <FormField label="Provider"><Select selectedOption={provider} options={PROVIDERS} onChange={({ detail }) => setProvider(detail.selectedOption as typeof provider)} /></FormField>
        </SpaceBetween>
      </Form>
    </form>
  );
}
