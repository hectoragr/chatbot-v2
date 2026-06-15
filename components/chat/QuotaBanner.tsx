'use client';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import type { QuotaStatusDTO } from '@/lib/client/api';

export function QuotaBanner({ quota }: { quota: QuotaStatusDTO }) {
  if (quota.blocked) {
    return (
      <Alert type="warning" header="You've reached your limit">
        {quota.reason === 'questions_exhausted'
          ? 'You have used all your free questions.'
          : 'You have used all your available tokens.'}
        {quota.resetsDaily ? ' Your limit resets tomorrow, or sign in / request more tokens.' : ' Sign in or request more tokens to continue.'}
      </Alert>
    );
  }
  return (
    <Box color="text-status-inactive" fontSize="body-s">
      {quota.remainingTokens} tokens
      {quota.remainingQuestions != null ? ` · ${quota.remainingQuestions} questions` : ''} remaining
    </Box>
  );
}
