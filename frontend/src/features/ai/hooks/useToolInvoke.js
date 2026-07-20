import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { aiApi } from '@/api/ai';
import { ApiError } from '@/api/client';
import { createMessage, parseFirstEntryData } from '@/features/ai/lib/conversationStorage';

// Drives the composer's Tools palette / slash commands — GET /ai/tools
// is the only source of what's available, so a new backend tool needs
// no frontend change to appear here.
export function useAiTools() {
  return useQuery({ queryKey: ['ai', 'tools'], queryFn: () => aiApi.listTools() });
}

// conversationId is taken per-call, not bound at hook-creation time —
// see useAskAgent.js's own comment for why (avoids a stale-activeId
// race when a caller just created a new conversation and wants to act
// on it immediately).
export function useToolInvoke({ appendMessage, replaceMessage }) {
  const [pendingMessageId, setPendingMessageId] = useState(null);

  const mutation = useMutation({
    mutationFn: ({ toolName, params, question }) => aiApi.invokeTool(toolName, params, question),
    onError: (err) => toast.error(err instanceof ApiError ? err.detail : 'Could not invoke that tool'),
  });

  const runInvocation = useCallback(async (conversationId, { toolName, params, question }, assistantMessageId) => {
    setPendingMessageId(assistantMessageId);
    try {
      const result = await mutation.mutateAsync({ toolName, params, question });
      replaceMessage(conversationId, assistantMessageId, {
        content: result.answer || '',
        toolUsed: toolName,
        presentation: result.presentation || null,
        rawData: parseFirstEntryData(result.entries),
      });
    } catch {
      replaceMessage(conversationId, assistantMessageId, {
        content: 'Sorry, that tool could not be run right now.',
      });
    } finally {
      setPendingMessageId(null);
    }
  }, [mutation, replaceMessage]);

  const invoke = useCallback(async (conversationId, {
    toolName, params, question, label,
  }) => {
    if (!conversationId) return;
    appendMessage(conversationId, createMessage({ role: 'user', content: label || `/${toolName}` }));
    const assistantMessage = createMessage({
      role: 'assistant', content: '', regenerate: {
        type: 'tool', toolName, params, question,
      },
    });
    appendMessage(conversationId, assistantMessage);
    await runInvocation(conversationId, { toolName, params, question }, assistantMessage.id);
  }, [appendMessage, runInvocation]);

  const regenerate = useCallback(async (conversationId, assistantMessageId, { toolName, params, question }) => {
    if (!conversationId) return;
    replaceMessage(conversationId, assistantMessageId, {
      content: '', toolUsed: null, presentation: null, rawData: null,
    });
    await runInvocation(conversationId, { toolName, params, question }, assistantMessageId);
  }, [replaceMessage, runInvocation]);

  return {
    invoke, regenerate, isPending: mutation.isPending, pendingMessageId,
  };
}
