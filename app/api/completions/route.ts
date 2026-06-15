import { getSessionUser } from '@/lib/auth';
import { resolveSubject } from '@/lib/subject';
import { getQuotaStatus, consumeQuota } from '@/lib/quota';
import { ensureConversation, getConversation, appendMessages, renameConversation, runSmallModelForSummary } from '@/lib/conversations';
import { runCompletion } from '@/lib/providers';
import { incrementTokenUsed } from '@/lib/tokens';
import { isValidModel, defaultModel, type Provider } from '@/lib/models';
import { verifyCSRFTokenValue } from '@/lib/csrf';
import { clientIp } from '@/lib/anon';
import { findBlock, blockSubjects } from '@/lib/blocks';
import { recordHitAndMaybeBlock } from '@/lib/abuse';
import { json, fail } from '@/lib/http';
import type { Message } from '@/lib/ddb';

export async function POST(req: Request) {
  if (!verifyCSRFTokenValue(req.headers.get('x-csrf-token'))) {
    return json({ error: 'CSRF_TOKEN_INVALID' }, 403);
  }
  try {
    const { message, conversationId, provider, model } = await req.json();
    if (!message || !provider) return json({ error: 'message and provider required' }, 400);

    const subject = await resolveSubject(req);

    // Abuse control (before quota): burst auto-block, then block check → 403.
    const ip = clientIp(req);
    const subjectEmail = subject.kind === 'user' ? subject.email : undefined;
    const burstTripped = await recordHitAndMaybeBlock(ip);
    const block = await findBlock(blockSubjects({ ip, email: subjectEmail }));
    if (burstTripped || block) {
      return json({ error: 'blocked', reason: block?.reason ?? 'burst_auto' }, 403);
    }

    const pre = await getQuotaStatus(subject);
    if (pre.blocked) {
      return json({ error: 'quota_exceeded', tier: pre.tier, reason: pre.reason, resetsDaily: pre.resetsDaily }, 402);
    }

    const user = await getSessionUser();
    const email = user?.email ?? `anon:${subject.kind === 'anon' ? subject.anonId : 'x'}`;
    const chosenModel = isValidModel(provider as Provider, model) ? model : defaultModel(provider as Provider);

    // Anonymous users are not persisted; logged-in users get conversations.
    const persist = !!user;
    let convo = persist
      ? await ensureConversation(conversationId, (subject as { token?: { token: string } }).token?.token ?? email, email, provider)
      : null;

    const now = new Date().toISOString();
    const userMsg: Message = { role: 'user', content: String(message), createdAt: now };
    const history: Message[] = [...(convo?.messages ?? []), userMsg];

    const result = await runCompletion(provider, chosenModel, history);
    const cost = result.estimatedTokens;

    // Enforce token ceiling for this single call.
    if (cost > pre.remainingTokens) {
      return json({ error: 'quota_exceeded', tier: pre.tier, reason: 'tokens_exhausted', remaining: pre.remainingTokens }, 402);
    }

    const assistantMsg: Message = { role: 'assistant', content: result.content, createdAt: new Date().toISOString() };

    // Charge: approved-with-token-room → charge the Token; everyone else → Usage ledger.
    if (subject.kind === 'user' && subject.approved && subject.token && (subject.token.limit - subject.token.used) > 0) {
      await incrementTokenUsed(subject.token.token, cost);
    } else {
      await consumeQuota(subject, cost);
    }

    if (convo) {
      if (conversationId !== convo.conversation_id) {
        const title = await runSmallModelForSummary(userMsg.content, assistantMsg.content);
        await renameConversation(convo.conversation_id, title);
        convo = (await getConversation(convo.conversation_id))!;
      }
      await appendMessages(convo.conversation_id, [userMsg, assistantMsg]);
    }

    const post = await getQuotaStatus(await resolveSubject(req));
    return json({
      valid: true,
      conversationId: convo?.conversation_id ?? null,
      message: assistantMsg,
      displayName: convo?.displayName ?? null,
      remaining: post.remainingTokens,
      blocked: post.blocked,
    });
  } catch (e) {
    return fail((e as Error)?.message);
  }
}
