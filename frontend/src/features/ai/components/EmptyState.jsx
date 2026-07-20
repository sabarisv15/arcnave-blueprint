import { Link } from 'react-router-dom';
import {
  CalendarCheck, Wallet, FileCheck, ClipboardList, CalendarDays, GraduationCap, Bell, Megaphone, BellRing, FolderOpen,
} from 'lucide-react';
import { ArcnaveAiMark } from '@/features/ai/components/ArcnaveAiMark';
import { PromptComposer } from '@/features/ai/components/PromptComposer';

const DEFAULT_IDEAS = [
  { icon: CalendarCheck, label: "Show today's attendance summary" },
  { icon: Wallet, label: 'Which fee payments are overdue?' },
  { icon: FileCheck, label: 'List students with pending document verification' },
  { icon: ClipboardList, label: "Summarize this week's pending approvals" },
];

// Sidebar shortcuts (Curriculum/Circulars/Reminders) are sections, not
// one-click actions — clicking one lands here with prompts scoped to
// that topic instead of immediately firing a question. Each prompt
// still routes to a real tool once clicked (same GET /ai/tools-backed
// path as any typed question); nothing here is decorative.
const TOPICS = {
  curriculum: {
    heading: 'Curriculum',
    subtitle: 'Syllabus, class timetables, and exam schedules.',
    icon: GraduationCap,
    documentsLink: true,
    ideas: [
      { icon: CalendarDays, label: 'Show the class timetable' },
      { icon: GraduationCap, label: 'Show assessment marks summary' },
    ],
  },
  circulars: {
    heading: 'Circulars',
    subtitle: 'Draft and track notifications sent to students or staff.',
    icon: Megaphone,
    documentsLink: true,
    ideas: [
      { icon: Megaphone, label: 'Help me draft a notification' },
      { icon: Bell, label: 'What notifications are pending approval?' },
    ],
  },
  reminders: {
    heading: 'Reminders',
    subtitle: "What's waiting on you this week.",
    icon: BellRing,
    ideas: [
      { icon: ClipboardList, label: "Summarize this week's pending approvals" },
      { icon: Wallet, label: 'Which fee payments are overdue?' },
    ],
  },
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning — where should we start?';
  if (hour < 17) return 'Good afternoon — what do you need?';
  return 'Good evening — one more thing before you go?';
}

// The centered "home" view: greeting (or a topic section's own
// heading), then the composer itself sits right below it (not pinned
// to the viewport's bottom edge — that only happens once a real
// conversation exists, see AiWorkspace), then suggested prompts below.
export function EmptyState({
  onPromptClick, onSend, onInvokeTool, tools, isPending, topic,
  documentAttachment, onAttachDocument, onRemoveDocumentAttachment,
}) {
  const section = topic ? TOPICS[topic] : null;
  const ideas = section ? section.ideas : DEFAULT_IDEAS;
  const TopicIcon = section?.icon;

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-6">
      <div className="space-y-3 text-center">
        {TopicIcon ? <TopicIcon className="mx-auto h-8 w-8 text-primary" /> : <ArcnaveAiMark size={36} className="mx-auto" />}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {section ? section.heading : greeting()}
        </h1>
        <p className="text-sm text-muted-foreground">
          {section ? section.subtitle : 'Ask about students, staff, attendance, fees, or documents — answers come straight from your campus data.'}
        </p>
      </div>

      <div className="w-full">
        <PromptComposer
          variant="embedded"
          onSend={onSend}
          onInvokeTool={onInvokeTool}
          tools={tools}
          isPending={isPending}
          documentAttachment={documentAttachment}
          onAttachDocument={onAttachDocument}
          onRemoveDocumentAttachment={onRemoveDocumentAttachment}
        />
      </div>

      {section?.documentsLink && (
        <Link
          to="/institutional-documents"
          className="flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-accent"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <FolderOpen className="h-4 w-4" />
          </span>
          Browse and upload in Institutional Documents
        </Link>
      )}

      <div className="w-full space-y-1 text-left">
        <div className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {section ? 'Suggested' : 'Ideas for you'}
        </div>
        {ideas.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPromptClick(label)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" />
            </span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
