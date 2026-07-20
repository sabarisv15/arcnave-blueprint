import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { FileUp, Paperclip, Send, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { AttachmentChip } from '@/features/ai/components/AttachmentChip';
import {
  isAllowedAttachment, readFileAsText, appendAttachmentToQuestion, ALLOWED_ATTACHMENT_EXTENSIONS,
} from '@/features/ai/lib/attachmentText';
import { fileToBase64 } from '@/lib/fileToBase64';

const MAX_TEXTAREA_HEIGHT = 200;

function ToolPaletteList({ tools, query, onSelect }) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter((t) => t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
  }, [tools, query]);

  if (filtered.length === 0) {
    return <p className="px-2 py-3 text-sm text-muted-foreground">No matching tools.</p>;
  }

  return (
    <div className="max-h-72 space-y-0.5 overflow-y-auto">
      {filtered.map((tool) => (
        <button
          key={tool.name}
          type="button"
          onClick={() => onSelect(tool)}
          className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
        >
          <span className="flex items-center gap-2 font-medium text-foreground">
            {tool.name}
            <Badge variant="outline" className="text-[10px]">{tool.level}</Badge>
          </span>
          <span className="text-xs text-muted-foreground">{tool.description}</span>
        </button>
      ))}
    </div>
  );
}

// variant="docked" — sticky bottom bar, used once a conversation has
// messages. variant="embedded" — a plain static block, used inside
// EmptyState so the composer sits centered directly under the
// greeting instead of pinned to the viewport's bottom edge.
export function PromptComposer({
  onSend, onInvokeTool, tools, isPending, variant = 'docked',
  documentAttachment, onAttachDocument, onRemoveDocumentAttachment,
}) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const documentInputRef = useRef(null);
  const wasPending = useRef(false);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (wasPending.current && !isPending) {
      textareaRef.current?.focus();
    }
    wasPending.current = isPending;
  }, [isPending]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  const slashQuery = value.startsWith('/') ? value.slice(1).split(' ')[0] : null;
  // Only auto-open while the user is still typing the tool name itself
  // (no space yet) — once a tool is selected, selectTool() appends a
  // trailing space, so this condition goes false and the palette stays
  // closed instead of immediately reopening and stealing focus/Enter.
  const stillComposingSlash = value.startsWith('/') && !value.slice(1).includes(' ');

  useEffect(() => {
    if (stillComposingSlash && (tools?.length || 0) > 0) setPaletteOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillComposingSlash, tools]);

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAllowedAttachment(file)) {
      toast.error(`Only ${ALLOWED_ATTACHMENT_EXTENSIONS.join(', ')} files are supported today.`);
      return;
    }
    try {
      const text = await readFileAsText(file);
      setAttachments((prev) => [...prev, { file, text }]);
    } catch {
      toast.error('Could not read that file');
    }
  }

  function removeAttachment(idx) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  // Any file type (unlike the text-only attach above) — kept as raw
  // base64 bytes, never folded into the question text. onAttachDocument
  // lives in AiWorkspace, not local state here: the attached file must
  // survive past this one submit() (the user still has to see the
  // AI's resolved destination and click Confirm before the actual
  // upload_institutional_document tool call fires — see EmptyState/
  // MessageDocument's own confirm-upload UI).
  async function handleDocumentChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onAttachDocument) return;
    try {
      const base64 = await fileToBase64(file);
      onAttachDocument({
        file, base64, fileName: file.name, mimeType: file.type || 'application/octet-stream',
      });
    } catch {
      toast.error('Could not read that file');
    }
  }

  function selectTool(tool) {
    setPaletteOpen(false);
    setValue(`/${tool.name} `);
    textareaRef.current?.focus();
  }

  function buildQuestion() {
    let question = value.trim();
    attachments.forEach((a) => {
      question = appendAttachmentToQuestion(question, a.file.name, a.text);
    });
    return question;
  }

  function submit() {
    if (isPending) return;
    const rawText = value.trim();
    if (!rawText) return;
    const question = buildQuestion();

    const slashMatch = /^\/(\S+)\s*([\s\S]*)$/.exec(rawText);
    const matchedTool = slashMatch && tools?.find((t) => t.name === slashMatch[1]);
    if (matchedTool) {
      const restQuestion = slashMatch[2].trim();
      onInvokeTool({
        toolName: matchedTool.name,
        params: {},
        question: restQuestion || undefined,
        label: rawText,
      });
    } else {
      onSend(question);
    }
    setValue('');
    setAttachments([]);
    setPaletteOpen(false);
  }

  function handleKeyDown(e) {
    if (paletteOpen && e.key === 'Escape') {
      setPaletteOpen(false);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setPaletteOpen(true);
    }
  }

  const docked = variant === 'docked';

  return (
    <div
      className={cn(
        docked && 'border-t border-border bg-page-gradient/80 px-4 pb-4 pt-3 backdrop-blur',
      )}
    >
      <div className={cn('mx-auto', docked ? 'max-w-3xl' : 'max-w-2xl')}>
        {(attachments.length > 0 || documentAttachment) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {attachments.map((a, idx) => (
              // eslint-disable-next-line react/no-array-index-key
              <AttachmentChip key={idx} file={a.file} onRemove={() => removeAttachment(idx)} />
            ))}
            {documentAttachment && (
              <AttachmentChip file={documentAttachment.file} onRemove={onRemoveDocumentAttachment} />
            )}
          </div>
        )}
        <div className="rounded-2xl border border-border bg-card shadow-card">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_ATTACHMENT_EXTENSIONS.join(',')}
            className="hidden"
            onChange={handleFileChosen}
          />
          {onAttachDocument && (
            <input
              ref={documentInputRef}
              type="file"
              className="hidden"
              onChange={handleDocumentChosen}
            />
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask ARCNAVE AI anything about your campus..."
            aria-label="Message ARCNAVE AI"
            className="max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Attach a text file"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              {onAttachDocument && (
                <button
                  type="button"
                  aria-label="Upload a document to Institutional Documents"
                  onClick={() => documentInputRef.current?.click()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <FileUp className="h-4 w-4" />
                </button>
              )}

              <Popover open={paletteOpen} onOpenChange={setPaletteOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Browse tools"
                    onClick={() => setPaletteOpen((o) => !o)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Wrench className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-80 p-2">
                  <ToolPaletteList tools={tools || []} query={slashQuery || ''} onSelect={selectTool} />
                </PopoverContent>
              </Popover>
            </div>

            <Button
              type="button"
              size="icon"
              aria-label="Send message"
              disabled={isPending || !value.trim()}
              onClick={submit}
              className="h-8 w-8 shrink-0 rounded-lg"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
