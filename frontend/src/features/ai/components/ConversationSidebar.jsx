import { useMemo, useRef, useState } from 'react';
import {
  Plus, Search, MoreHorizontal, Pencil, Trash2, PanelLeftClose, PanelLeft,
  MessagesSquare, FolderKanban, ChevronDown, ChevronRight, X, FolderInput,
  BookOpen, Megaphone, BellRing,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

// Domain shortcuts — always-pinned nav (ARCNAVE AI's equivalent of
// Claude's Code/Cowork/Design product switches). These are sections,
// not one-click actions: clicking one lands on a fresh empty
// conversation showing prompts scoped to that topic (EmptyState.jsx's
// own TOPICS map) — the user still picks what to actually send, same
// as the default "Ideas for you" list. Each suggested prompt routes to
// a real tool once clicked (academic_class_timetable for Curriculum,
// draft_notification for Circulars, workflow_pending_summary for
// Reminders — confirmed against the live GET /ai/tools registry), so
// nothing here is decorative even though nothing auto-sends.
// Neither Curriculum nor Circulars is a document-upload/browse
// feature — the Documents module has no listing endpoint for
// institution-wide (non-student) files, only a per-student one, so
// there's nothing real to wire a storage UI to yet (see chat for the
// backend gap this would need).
const SHORTCUTS = [
  { key: 'curriculum', icon: BookOpen, label: 'Curriculum' },
  { key: 'circulars', icon: Megaphone, label: 'Circulars' },
  { key: 'reminders', icon: BellRing, label: 'Reminders' },
];

function matchesQuery(conversation, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  if (conversation.title.toLowerCase().includes(q)) return true;
  return conversation.messages.some((m) => m.content?.toLowerCase().includes(q));
}

function ConversationRow({
  conversation, active, onSelect, onRename, onDelete, projects, onMoveToProject,
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(conversation.title);

  function commitRename() {
    setEditing(false);
    const trimmed = title.trim();
    if (trimmed && trimmed !== conversation.title) onRename(conversation.id, trimmed);
    else setTitle(conversation.title);
  }

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm',
        active ? 'bg-dark text-dark-foreground' : 'text-foreground hover:bg-accent',
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') { setTitle(conversation.title); setEditing(false); }
          }}
          className="w-full truncate bg-transparent text-sm outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => onSelect(conversation.id)}
          className="min-w-0 flex-1 truncate text-left"
        >
          {conversation.title}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More actions for ${conversation.title}`}
            className={cn(
              'shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              active ? 'hover:bg-dark-foreground/10' : 'hover:bg-accent',
            )}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="h-3.5 w-3.5" />
              Move to project
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  onSelect={() => onMoveToProject(conversation.id, null)}
                  disabled={!conversation.projectId}
                >
                  No project
                </DropdownMenuItem>
                {projects.length > 0 && <DropdownMenuSeparator />}
                {projects.map((project) => (
                  <DropdownMenuItem
                    key={project.id}
                    onSelect={() => onMoveToProject(conversation.id, project.id)}
                    disabled={conversation.projectId === project.id}
                  >
                    {project.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() => onDelete(conversation.id)}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ProjectsSection({
  projects, activeProjectId, onSelectProject, onCreateProject, onRenameProject, onDeleteProject, onNewInProject,
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  function commitCreate() {
    const trimmed = newName.trim();
    if (trimmed) onCreateProject(trimmed);
    setNewName('');
    setCreating(false);
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground hover:bg-accent"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <FolderKanban className="h-4 w-4" />
        Projects
      </button>
      {open && (
        <div className="ml-2 space-y-0.5 border-l border-border pl-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className={cn(
                'group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm',
                activeProjectId === project.id ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent',
              )}
            >
              <button
                type="button"
                onClick={() => onSelectProject(activeProjectId === project.id ? null : project.id)}
                className="min-w-0 flex-1 truncate text-left"
              >
                {project.name}
              </button>
              <button
                type="button"
                aria-label={`New chat in ${project.name}`}
                onClick={() => onNewInProject(project.id)}
                className="shrink-0 rounded p-1 opacity-0 hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`More actions for ${project.name}`}
                    className="shrink-0 rounded p-1 opacity-0 hover:bg-accent group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => {
                    const name = window.prompt('Rename project', project.name);
                    if (name) onRenameProject(project.id, name);
                  }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onDeleteProject(project.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {creating ? (
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={commitCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate();
                if (e.key === 'Escape') { setNewName(''); setCreating(false); }
              }}
              placeholder="Project name"
              className="w-full rounded-lg bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              New project
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function ConversationSidebar({
  conversations, activeId, onSelect, onNew, onRename, onDelete, collapsed, onToggleCollapse,
  projects, onCreateProject, onRenameProject, onDeleteProject, onMoveToProject, onShortcut, activeTopic,
}) {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [activeProjectId, setActiveProjectId] = useState(null);
  const searchRef = useRef(null);

  const filtered = useMemo(
    () => conversations
      // An untouched empty chat never appears in the list — not even
      // while it's the active one — matching Claude's own sidebar,
      // which only lists a conversation once it actually has content.
      .filter((c) => c.messages.length > 0)
      .filter((c) => (activeProjectId ? c.projectId === activeProjectId : true))
      .filter((c) => matchesQuery(c, query)),
    [conversations, query, activeProjectId],
  );

  const activeProject = projects.find((p) => p.id === activeProjectId) || null;

  function handleNewChat() {
    onNew(activeProjectId);
  }

  function handleNewInProject(projectId) {
    onNew(projectId);
    setActiveProjectId(projectId);
  }

  if (collapsed) {
    return (
      <div className="flex h-full w-14 flex-col items-center gap-2 border-r border-border bg-card/60 py-3">
        <button
          type="button"
          aria-label="Expand sidebar"
          onClick={onToggleCollapse}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="New chat"
          onClick={() => onNew()}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-72 flex-col border-r border-border bg-card/60">
      <div className="flex items-center gap-2 p-3 pb-1">
        <button
          type="button"
          onClick={handleNewChat}
          className="flex flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <Plus className="h-4 w-4 text-primary" />
          {activeProject ? `New chat in ${activeProject.name}` : 'New chat'}
        </button>
        <button
          type="button"
          aria-label="Collapse sidebar"
          onClick={onToggleCollapse}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-0.5 px-3 pb-2">
        <button
          type="button"
          onClick={() => searchRef.current?.focus()}
          className="flex w-full items-center gap-2 rounded-lg bg-accent px-2.5 py-2 text-left text-sm font-medium text-foreground"
        >
          <MessagesSquare className="h-4 w-4" />
          Chats
        </button>

        <ProjectsSection
          projects={projects}
          activeProjectId={activeProjectId}
          onSelectProject={setActiveProjectId}
          onCreateProject={onCreateProject}
          onRenameProject={onRenameProject}
          onDeleteProject={onDeleteProject}
          onNewInProject={handleNewInProject}
        />
      </div>

      <div className="space-y-0.5 border-t border-border px-3 py-2">
        {SHORTCUTS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => onShortcut(key)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
              activeTopic === key ? 'bg-accent text-foreground' : 'text-foreground hover:bg-accent',
            )}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            {label}
          </button>
        ))}
      </div>

      <div className="border-t border-border px-3 pt-2">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <ScrollArea className="flex-1 px-2 pt-2">
        <div className="space-y-0.5 pb-3">
          <div className="flex items-center justify-between px-2 pb-1 pt-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {activeProject ? activeProject.name : 'Recents'}
            </span>
            {activeProject && (
              <button
                type="button"
                onClick={() => setActiveProjectId(null)}
                aria-label="Clear project filter"
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              {query ? 'No conversations found.' : 'No conversations yet.'}
            </p>
          )}
          {filtered.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
              projects={projects}
              onMoveToProject={onMoveToProject}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="flex items-center gap-2 border-t border-border p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dark text-xs font-bold text-dark-foreground">
          {(user?.role || '?').slice(0, 2).toUpperCase()}
        </div>
        <span className="truncate text-sm font-medium capitalize text-foreground">{user?.role || 'Signed in'}</span>
      </div>
    </div>
  );
}
