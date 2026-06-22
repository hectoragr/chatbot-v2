'use client';
import { useTranslation } from 'react-i18next';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { QuotaStatusDTO } from '@/lib/client/api';

const PROVIDER_LABELS: Record<string, string> = { OPENAI: 'OpenAI', DEEPSEEK: 'DeepSeek', ANY: 'Any' };

interface Props {
  quota: QuotaStatusDTO;
  pendingApproval?: boolean;
  providerRemaining?: Record<string, number>;
}

export function QuotaBanner({ quota, pendingApproval, providerRemaining }: Props) {
  const { t } = useTranslation();

  if (quota.blocked) {
    return (
      <Alert type="warning" header={t('quotaLimitReached')}>
        {quota.reason === 'questions_exhausted'
          ? t('questionsExhausted')
          : t('tokensExhausted')}
        {quota.resetsDaily ? ` ${t('limitResetsOrSignIn')}` : ` ${t('signInOrRequestTokens')}`}
      </Alert>
    );
  }

  // Build per-provider breakdown string
  const providerEntries = providerRemaining
    ? Object.entries(providerRemaining).filter(([key]) => key !== 'ANY')
    : [];
  const showBreakdown = providerEntries.length > 1;

  const breakdownStr = showBreakdown
    ? providerEntries.map(([key, val]) => `${PROVIDER_LABELS[key] ?? key}: ${val}`).join(' · ') + ' · '
    : '';

  return (
    <SpaceBetween size="xxs">
      {pendingApproval && (
        <Alert type="info" header={t('pendingApproval')}>
          {t('pendingApprovalBody')}
        </Alert>
      )}
      <Box color="text-status-inactive" fontSize="body-s">
        {breakdownStr}
        {t('tokensCount', { count: quota.remainingTokens })}
        {quota.remainingQuestions != null ? ` · ${t('questionsCount', { count: quota.remainingQuestions })}` : ''} {t('remaining')}
      </Box>
    </SpaceBetween>
  );
}
