import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  loadConversations, saveConversations, createConversation, titleFromMessage,
  loadProjects, saveProjects, createProject as createProjectRecord,
} from '@/features/ai/lib/conversationStorage';

const SIDEBAR_COLLAPSED_KEY = 'arcnave.ai.sidebarCollapsed';

export function useConversations() {
  const { user } = useAuth();
  const namespace = user ? `${user.collegeId || 'na'}.${user.userId || 'na'}` : 'anonymous';

  const [conversations, setConversations] = useState(() => loadConversations(namespace));
  const [activeId, setActiveId] = useState(() => conversations[0]?.id || null);
  const [projects, setProjects] = useState(() => loadProjects(namespace));

  useEffect(() => {
    const loaded = loadConversations(namespace);
    setConversations(loaded);
    setActiveId(loaded[0]?.id || null);
    setProjects(loadProjects(namespace));
  }, [namespace]);

  // Mirrors state to localStorage whenever it changes, rather than
  // inside each mutator below — two mutators can fire back-to-back in
  // the same tick (e.g. appending a user turn then an assistant
  // placeholder), and setState updater functions must stay pure, so
  // persistence lives here instead of inline in a setConversations call.
  // Empty (no-message) conversations are never written — a "New chat"
  // click or a fresh mount only produces a real, listed conversation
  // once the user actually sends something, same as Claude's own
  // sidebar never listing an untouched new chat.
  const namespaceRef = useRef(namespace);
  namespaceRef.current = namespace;
  useEffect(() => {
    saveConversations(namespaceRef.current, conversations.filter((c) => c.messages.length > 0));
  }, [conversations]);
  useEffect(() => {
    saveProjects(namespaceRef.current, projects);
  }, [projects]);

  // Tracked so newConversation (a useCallback with an empty dep array,
  // called from effects/keyboard handlers) can read current state
  // without becoming stale — see the appendMessage/replaceMessage
  // comment below for why these mutators avoid closing over `conversations`.
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Every mutator below uses the functional setState form — never
  // reads the `conversations` closure variable — so that two calls
  // issued synchronously in the same event (e.g. useAskAgent appending
  // a user message immediately followed by an assistant placeholder)
  // each build on the other's update instead of one clobbering the
  // other via a stale snapshot.
  const newConversation = useCallback((projectId = null) => {
    // Already sitting on an untouched empty chat in the same project —
    // reuse it instead of stacking another blank entry (matches
    // Claude: clicking "New chat" while already on one does nothing new).
    const current = conversationsRef.current.find((c) => c.id === activeIdRef.current);
    if (current && current.messages.length === 0 && (current.projectId || null) === (projectId || null)) {
      return current.id;
    }

    const conversation = createConversation(projectId);
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    return conversation.id;
  }, []);

  const createProject = useCallback((name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return null;
    const project = createProjectRecord(trimmed);
    setProjects((prev) => [...prev, project]);
    return project.id;
  }, []);

  const renameProject = useCallback((id, name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)));
  }, []);

  const deleteProject = useCallback((id) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    // Conversations filed under a deleted project become unfiled
    // rather than vanishing — deleting a folder shouldn't delete its
    // contents.
    setConversations((prev) => prev.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)));
  }, []);

  const assignConversationToProject = useCallback((conversationId, projectId) => {
    setConversations((prev) => prev.map((c) => (
      c.id === conversationId ? { ...c, projectId: projectId || null } : c
    )));
  }, []);

  const renameConversation = useCallback((id, title) => {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }, []);

  const deleteConversation = useCallback((id) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setActiveId((current) => (current === id ? (next[0]?.id || null) : current));
      return next;
    });
  }, []);

  const appendMessage = useCallback((conversationId, message) => {
    setConversations((prev) => prev.map((c) => {
      if (c.id !== conversationId) return c;
      const isFirstUserMessage = message.role === 'user' && c.messages.length === 0;
      return {
        ...c,
        title: isFirstUserMessage ? titleFromMessage(message.content) : c.title,
        messages: [...c.messages, message],
      };
    }));
  }, []);

  const replaceMessage = useCallback((conversationId, messageId, patch) => {
    setConversations((prev) => prev.map((c) => {
      if (c.id !== conversationId) return c;
      return { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) };
    }));
  }, []);

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) || null,
    [conversations, activeId],
  );

  return {
    conversations,
    activeConversation,
    activeId,
    setActiveId,
    newConversation,
    renameConversation,
    deleteConversation,
    appendMessage,
    replaceMessage,
    projects,
    createProject,
    renameProject,
    deleteProject,
    assignConversationToProject,
  };
}

const MOBILE_BREAKPOINT_PX = 768;

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      // No explicit user choice yet — default to collapsed on a narrow
      // viewport so the fixed-width sidebar never crowds out the
      // conversation column on first load (mobile).
      if (stored === null) return window.innerWidth < MOBILE_BREAKPOINT_PX;
      return stored === '1';
    } catch {
      return false;
    }
  });

  // Only auto-adjusts when the user hasn't made an explicit choice this
  // browser (no stored preference) — once they toggle manually, that
  // choice persists across viewport changes.
  useEffect(() => {
    if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) !== null) return undefined;
    function handleResize() {
      setCollapsed(window.innerWidth < MOBILE_BREAKPOINT_PX);
    }
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // best-effort persistence only
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}
