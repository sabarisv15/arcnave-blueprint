const STORAGE_PREFIX = 'arcnave.ai.conversations.';
const PROJECTS_STORAGE_PREFIX = 'arcnave.ai.projects.';

function storageKey(namespace) {
  return `${STORAGE_PREFIX}${namespace || 'anonymous'}`;
}

function projectsStorageKey(namespace) {
  return `${PROJECTS_STORAGE_PREFIX}${namespace || 'anonymous'}`;
}

export function loadConversations(namespace) {
  try {
    const raw = localStorage.getItem(storageKey(namespace));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveConversations(namespace, conversations) {
  try {
    localStorage.setItem(storageKey(namespace), JSON.stringify(conversations));
  } catch {
    // localStorage can throw (quota, private browsing) — history is a
    // convenience layer, never block the conversation on persisting it.
  }
}

// Projects are a real, client-side-only grouping of conversations (no
// backend concept exists) — a named folder a user files chats into,
// same storage pattern/namespace as conversations themselves.
export function loadProjects(namespace) {
  try {
    const raw = localStorage.getItem(projectsStorageKey(namespace));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveProjects(namespace, projects) {
  try {
    localStorage.setItem(projectsStorageKey(namespace), JSON.stringify(projects));
  } catch {
    // best-effort persistence only, same as saveConversations above
  }
}

export function createProject(name) {
  return {
    id: randomId(),
    name,
    createdAt: new Date().toISOString(),
  };
}

function randomId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function createConversation(projectId = null) {
  return {
    id: randomId(),
    title: 'New chat',
    createdAt: new Date().toISOString(),
    messages: [],
    projectId: projectId || null,
  };
}

export function createMessage({
  role, content, toolUsed, presentation, rawData, regenerate,
}) {
  return {
    id: randomId(),
    role,
    content,
    toolUsed: toolUsed || null,
    presentation: presentation || null,
    rawData: rawData !== undefined ? rawData : null,
    // { type: 'ask', question } | { type: 'tool', toolName, params, question } | null —
    // lets MessageDocument's Regenerate control re-issue the exact
    // request that produced this turn, without persisting duplicate
    // request-tracking state anywhere else.
    regenerate: regenerate || null,
    createdAt: new Date().toISOString(),
  };
}

// The backend's sanitized entries carry each context entry's data as a
// JSON string (aiPromptSafetyLayer.js's wrapEntry) — parsed once here
// so the frontend never re-implements that parsing in more than one
// place. Used only for entity-link resolution (InlineRenderer/
// DataTable); the display data itself always comes from
// result.presentation.sections.
export function parseFirstEntryData(entries) {
  const first = Array.isArray(entries) ? entries[0] : null;
  if (!first) return null;
  try {
    return JSON.parse(first.data);
  } catch {
    return null;
  }
}

// First few words of the first user message, so a thread doesn't sit
// in the sidebar forever labeled "New chat".
export function titleFromMessage(content) {
  const trimmed = (content || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'New chat';
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
}
