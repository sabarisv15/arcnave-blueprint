import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useConversations, useSidebarCollapsed } from '@/features/ai/hooks/useConversations';
import { useAskAgent } from '@/features/ai/hooks/useAskAgent';
import { useToolInvoke, useAiTools } from '@/features/ai/hooks/useToolInvoke';
import { ConversationSidebar } from '@/features/ai/components/ConversationSidebar';
import { ConversationThread } from '@/features/ai/components/ConversationThread';
import { PromptComposer } from '@/features/ai/components/PromptComposer';
import { ArcnaveAiMark } from '@/features/ai/components/ArcnaveAiMark';

const THEME_CLASS = 'arcnave-ai-theme';

export function AiWorkspace() {
  const {
    conversations, activeConversation, activeId, setActiveId,
    newConversation, renameConversation, deleteConversation, appendMessage, replaceMessage,
    projects, createProject, renameProject, deleteProject, assignConversationToProject,
  } = useConversations();
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed();
  // Which sidebar topic section (Curriculum/Circulars/Reminders) the
  // current empty conversation was opened from, if any — drives which
  // suggested prompts EmptyState shows. Cleared by any navigation that
  // isn't itself a topic click, so a plain "New chat" never inherits
  // the previous topic's suggestions.
  const [topic, setTopic] = useState(null);
  // The file a user attached via the composer's "Upload a document"
  // button, waiting on resolve_document_destination's answer + an
  // explicit Confirm click before upload_institutional_document
  // actually runs (see aiToolRegistry.js's own comment on why that
  // tool is humanOnly). Cleared on confirm, cancel, or switching
  // conversations — it's a single in-flight upload, not per-message
  // state worth persisting.
  const [documentAttachment, setDocumentAttachment] = useState(null);

  const askAgent = useAskAgent({ appendMessage, replaceMessage });
  const toolInvoke = useToolInvoke({ appendMessage, replaceMessage });
  const { data: tools } = useAiTools();

  // Always keep a conversation active — the composer assumes activeId
  // is non-null (createMessage/appendMessage no-op otherwise). Covers
  // both first load (no conversations yet) and deleting the last
  // remaining conversation.
  useEffect(() => {
    if (!activeId) newConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Scoped to this route only — the rest of the app keeps its light
  // gold/cream theme untouched (see index.css's :root.arcnave-ai-theme).
  useEffect(() => {
    document.documentElement.classList.add(THEME_CLASS);
    return () => document.documentElement.classList.remove(THEME_CLASS);
  }, []);

  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newConversation();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [newConversation]);

  function handleSend(question) {
    askAgent.ask(activeId, question);
  }

  function handleInvokeTool(payload) {
    toolInvoke.invoke(activeId, payload);
  }

  // The actual write — only ever fired by this explicit handler
  // (MessageDocument's own Confirm button), never by the LLM. resolved
  // carries whatever resolve_document_destination already matched;
  // category is required (upload_institutional_document's own schema),
  // department/academic_year are passed through only if resolved.
  function handleConfirmUpload(resolved) {
    if (!documentAttachment || !resolved?.category?.id) return;
    toolInvoke.invoke(activeId, {
      toolName: 'upload_institutional_document',
      params: {
        title: documentAttachment.fileName,
        category: resolved.category.id,
        department: resolved.department?.id,
        academic_year: resolved.academicYear?.id,
        file_name: documentAttachment.fileName,
        mime_type: documentAttachment.mimeType,
        file_base64: documentAttachment.base64,
      },
      label: `Confirm upload: ${documentAttachment.fileName}`,
    });
    setDocumentAttachment(null);
  }

  // Domain shortcuts (sidebar) are sections, not one-click actions —
  // clicking one lands on a fresh empty conversation with prompts
  // scoped to that topic (EmptyState.jsx's TOPICS map); nothing is
  // sent until the user picks one. Reuses the same empty-draft-or-new
  // logic newConversation() already has for the plain "New chat" case.
  function handleShortcut(topicKey) {
    newConversation();
    setTopic(topicKey);
  }

  // Any navigation that isn't a topic click clears the topic, so the
  // next empty conversation shown falls back to the default "Ideas for
  // you" list instead of stale topic-scoped suggestions.
  function handleSelect(id) {
    setTopic(null);
    setActiveId(id);
  }

  function handleNewChat(projectId) {
    setTopic(null);
    return newConversation(projectId);
  }

  const hasMessages = (activeConversation?.messages.length || 0) > 0;

  return (
    <div className="flex h-screen flex-col bg-page-gradient">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <Link
          to="/"
          className="flex items-center gap-1.5 rounded-full border-[1.5px] border-foreground/20 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          ARCNAVE
        </Link>
        <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground">
          <ArcnaveAiMark size={16} />
          ARCNAVE AI
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ConversationSidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={handleSelect}
          onNew={handleNewChat}
          onRename={renameConversation}
          onDelete={deleteConversation}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          projects={projects}
          onCreateProject={createProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onMoveToProject={assignConversationToProject}
          onShortcut={handleShortcut}
          activeTopic={topic}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ConversationThread
              conversation={activeConversation}
              conversationId={activeId}
              askAgent={askAgent}
              toolInvoke={toolInvoke}
              tools={tools}
              onInvokeTool={handleInvokeTool}
              topic={topic}
              documentAttachment={documentAttachment}
              onAttachDocument={setDocumentAttachment}
              onRemoveDocumentAttachment={() => setDocumentAttachment(null)}
              onConfirmUpload={handleConfirmUpload}
            />
          </div>
          {hasMessages && (
            <PromptComposer
              variant="docked"
              onSend={handleSend}
              onInvokeTool={handleInvokeTool}
              tools={tools}
              isPending={askAgent.isPending || toolInvoke.isPending || !activeId}
              documentAttachment={documentAttachment}
              onAttachDocument={setDocumentAttachment}
              onRemoveDocumentAttachment={() => setDocumentAttachment(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
