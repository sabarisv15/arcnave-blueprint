import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmptyState } from '@/features/ai/components/EmptyState';
import { MessageDocument } from '@/features/ai/components/MessageDocument';

export function ConversationThread({
  conversation, conversationId, askAgent, toolInvoke, tools, onInvokeTool, topic,
  documentAttachment, onAttachDocument, onRemoveDocumentAttachment, onConfirmUpload,
}) {
  const bottomRef = useRef(null);
  const messages = conversation?.messages || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  function handleRegenerate(message) {
    if (!message.regenerate) return;
    if (message.regenerate.type === 'ask') {
      askAgent.regenerate(conversationId, message.id, message.regenerate.question);
    } else if (message.regenerate.type === 'tool') {
      const { toolName, params, question } = message.regenerate;
      toolInvoke.regenerate(conversationId, message.id, { toolName, params, question });
    }
  }

  function handleFollowUpClick(followUp) {
    askAgent.ask(conversationId, followUp.label);
  }

  function handleStarterPrompt(prompt) {
    askAgent.ask(conversationId, prompt);
  }

  if (!conversation || messages.length === 0) {
    return (
      <EmptyState
        onPromptClick={handleStarterPrompt}
        onSend={(question) => askAgent.ask(conversationId, question)}
        onInvokeTool={(payload) => onInvokeTool(payload)}
        tools={tools}
        isPending={askAgent.isPending || toolInvoke.isPending}
        topic={topic}
        documentAttachment={documentAttachment}
        onAttachDocument={onAttachDocument}
        onRemoveDocumentAttachment={onRemoveDocumentAttachment}
      />
    );
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const pendingId = askAgent.pendingMessageId || toolInvoke.pendingMessageId;

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl pb-6 pt-4">
        {messages.map((message) => (
          <MessageDocument
            key={message.id}
            message={message}
            isLatestAssistant={message.id === lastAssistantId}
            isPending={message.id === pendingId}
            onRegenerate={handleRegenerate}
            onFollowUpClick={handleFollowUpClick}
            isLatestMessage={message.id === messages[messages.length - 1]?.id}
            documentAttachment={documentAttachment}
            onConfirmUpload={onConfirmUpload}
            onCancelUpload={onRemoveDocumentAttachment}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
