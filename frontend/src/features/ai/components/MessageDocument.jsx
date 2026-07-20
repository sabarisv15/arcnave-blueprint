import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Copy, RotateCcw, Check, Upload, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { InlineRenderer } from '@/features/ai/components/InlineRenderer';
import { ArcnaveAiMark } from '@/features/ai/components/ArcnaveAiMark';

// Message ids already fully streamed-in this session — a plain module-
// level Set (no persistence needed: the "reveal" effect is a first-view
// nicety only, re-streaming an already-read answer on reload would be
// noise, not a feature).
const streamedIds = new Set();
const STREAM_CHUNK_CHARS = 6;
const STREAM_INTERVAL_MS = 12;

// Copy is structure-aware: a table-shaped answer copies as clean
// Markdown/TSV-ish text, not a raw JSON dump.
function toPlainText(message) {
  const parts = [];
  if (message.content) parts.push(message.content);
  const details = message.presentation?.sections?.details;
  if (details?.type === 'table') {
    parts.push(details.columns.join('\t'));
    details.rows.forEach((row) => parts.push(row.join('\t')));
  } else if (details?.type === 'list') {
    details.items.forEach((item) => parts.push(`- ${item}`));
  }
  const metrics = message.presentation?.sections?.keyMetrics;
  if (metrics && metrics.length > 0) {
    metrics.forEach((m) => parts.push(`${m.label}: ${m.value}`));
  }
  return parts.join('\n');
}

function useStreamedText(message, shouldStream) {
  const fullText = message.content || '';
  const [revealed, setRevealed] = useState(() => (
    shouldStream && !streamedIds.has(message.id) ? '' : fullText
  ));

  useEffect(() => {
    if (!shouldStream || streamedIds.has(message.id) || !fullText) {
      setRevealed(fullText);
      return undefined;
    }
    let i = 0;
    const timer = setInterval(() => {
      i += STREAM_CHUNK_CHARS;
      if (i >= fullText.length) {
        setRevealed(fullText);
        streamedIds.add(message.id);
        clearInterval(timer);
      } else {
        setRevealed(fullText.slice(0, i));
      }
    }, STREAM_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, fullText, shouldStream]);

  return revealed;
}

// resolve_document_destination's confirm step (see aiToolRegistry.js's
// own comment) — the ONE place upload_institutional_document ever
// gets called from, always by this explicit user click, never by the
// LLM. Only renders on the latest message, with a file still pending,
// and only once the tool has actually finished resolving (not while
// isPending) — a stale confirm button on an older turn, or one shown
// before resolution finished, would let a user confirm against a
// destination that was never actually checked.
function DocumentUploadConfirm({ resolved, documentAttachment, onConfirm, onCancel }) {
  const category = resolved.category;
  const department = resolved.department;
  const academicYear = resolved.academicYear;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
      <p className="font-medium text-foreground">Upload &ldquo;{documentAttachment.fileName}&rdquo;?</p>
      <ul className="space-y-1 text-muted-foreground">
        <li>
          Category: {category ? <span className="text-foreground">{category.name}</span> : <span className="text-destructive">{resolved.categoryError || 'not found — required'}</span>}
        </li>
        <li>
          Department: {department ? <span className="text-foreground">{department.name}</span> : (resolved.departmentError ? <span className="text-destructive">{resolved.departmentError}</span> : 'College-wide')}
        </li>
        <li>
          Academic Year: {academicYear ? <span className="text-foreground">{academicYear.name}</span> : (resolved.academicYearError ? <span className="text-destructive">{resolved.academicYearError}</span> : 'Active year')}
        </li>
      </ul>
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="gap-1.5" disabled={!category} onClick={() => onConfirm(resolved)}>
          <Upload className="h-3.5 w-3.5" /> Confirm &amp; Upload
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onCancel}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
      </div>
    </div>
  );
}

export function MessageDocument({
  message, isLatestAssistant, isPending, onRegenerate, onFollowUpClick,
  isLatestMessage, documentAttachment, onConfirmUpload, onCancelUpload,
}) {
  const [copied, setCopied] = useState(false);
  const isAssistant = message.role === 'assistant';
  const shouldStream = isAssistant && isLatestAssistant;
  const revealedText = useStreamedText(message, shouldStream);
  const isStreaming = shouldStream && revealedText !== (message.content || '') && Boolean(message.content);

  const sections = message.presentation?.sections;
  const followUps = message.presentation?.followUps;
  const hasStructured = Boolean(sections && (
    (sections.keyMetrics && sections.keyMetrics.length > 0)
    || sections.details
    || (sections.insights && sections.insights.length > 0)
    || (sections.recommendedActions && sections.recommendedActions.length > 0)
  ));
  const showFollowUps = isAssistant && !isPending && hasStructured && followUps && followUps.length > 0;

  const headingText = !message.content && sections?.title ? sections.title : null;

  const displayText = useMemo(() => revealedText, [revealedText]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(toPlainText(message));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  // User turns: a compact right-aligned bubble, no icon/label — matches
  // Claude's own convention (only the assistant's response is rendered
  // as a full-width "document").
  if (!isAssistant) {
    return (
      <div className="px-4 py-3">
        <div className="flex justify-end">
          <p className="max-w-[75%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-2.5 text-sm text-secondary-foreground">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  if (isPending && !message.content) {
    return (
      <div className="flex gap-3 px-4 py-3">
        <ArcnaveAiMark size={16} className="mt-1 shrink-0" />
        <div className="w-full space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 px-4 py-3">
      <ArcnaveAiMark size={16} className="mt-1 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2.5">
        {message.toolUsed && <Badge variant="secondary">{message.toolUsed}</Badge>}

        {headingText && <h3 className="text-sm font-semibold text-foreground">{headingText}</h3>}

        {displayText && (
          <div className="ai-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayText}</ReactMarkdown>
          </div>
        )}

        {!isStreaming && sections && (
          <InlineRenderer sections={sections} rawData={message.rawData} toolUsed={message.toolUsed} />
        )}

        {!isPending && isLatestMessage && documentAttachment && message.toolUsed === 'resolve_document_destination' && message.rawData && (
          <DocumentUploadConfirm
            resolved={message.rawData}
            documentAttachment={documentAttachment}
            onConfirm={onConfirmUpload}
            onCancel={onCancelUpload}
          />
        )}

        {!isPending && !isStreaming && (
          <div className="flex items-center gap-1 pt-1">
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy response"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {message.regenerate && (
              <button
                type="button"
                onClick={() => onRegenerate(message)}
                aria-label="Regenerate response"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Regenerate
              </button>
            )}
          </div>
        )}

        {showFollowUps && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {followUps.map((followUp) => (
              <button
                key={followUp.tool}
                type="button"
                onClick={() => onFollowUpClick(followUp)}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground shadow-sm transition-colors hover:bg-accent"
              >
                {followUp.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
