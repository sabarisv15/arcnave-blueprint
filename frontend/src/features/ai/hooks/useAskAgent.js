import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { aiApi } from '@/api/ai';
import { ApiError } from '@/api/client';
import { createMessage, parseFirstEntryData } from '@/features/ai/lib/conversationStorage';

// Wraps aiApi.ask with the per-turn pending state a conversation UI
// needs (aiApi itself stays a plain, unchanged request/response call —
// no backend behavior implied here). conversationId is taken per-call,
// not bound at hook-creation time — a caller that just created a new
// conversation (newConversation() returns its id synchronously, before
// the activeId state update has actually re-rendered) can target it
// immediately instead of racing a stale activeId closure.
export function useAskAgent({ appendMessage, replaceMessage }) {
  const [pendingMessageId, setPendingMessageId] = useState(null);

  const mutation = useMutation({
    mutationFn: (question) => aiApi.ask(question),
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not reach ARCNAVE AI'),
  });

  const runTurn = useCallback(async (conversationId, question, assistantMessageId) => {
    setPendingMessageId(assistantMessageId);
    try {
      const result = await mutation.mutateAsync(question);
      replaceMessage(conversationId, assistantMessageId, {
        content: result.answer || '',
        toolUsed: result.toolUsed || null,
        presentation: result.presentation || null,
        rawData: parseFirstEntryData(result.entries),
      });
    } catch {
      replaceMessage(conversationId, assistantMessageId, {
        content: 'Sorry, I could not reach ARCNAVE AI. Please try again.',
      });
    } finally {
      setPendingMessageId(null);
    }
  }, [mutation, replaceMessage]);

  const ask = useCallback(async (conversationId, question) => {
    if (!conversationId || !question?.trim()) return;
    appendMessage(conversationId, createMessage({ role: 'user', content: question }));
    const assistantMessage = createMessage({
      role: 'assistant', content: '', regenerate: { type: 'ask', question },
    });
    appendMessage(conversationId, assistantMessage);
    await runTurn(conversationId, question, assistantMessage.id);
  }, [appendMessage, runTurn]);

  // Regenerate: resend the same question text as a fresh independent
  // POST /ai/ask call (the backend has no multi-turn memory to
  // "regenerate from") and replace the same assistant turn in place.
  const regenerate = useCallback(async (conversationId, assistantMessageId, question) => {
    if (!conversationId || !question?.trim()) return;
    replaceMessage(conversationId, assistantMessageId, {
      content: '', toolUsed: null, presentation: null, rawData: null,
    });
    await runTurn(conversationId, question, assistantMessageId);
  }, [replaceMessage, runTurn]);

  return {
    ask, regenerate, isPending: mutation.isPending, pendingMessageId,
  };
}
