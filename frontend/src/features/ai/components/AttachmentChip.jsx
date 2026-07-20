import { FileText, X } from 'lucide-react';

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function AttachmentChip({ file, onRemove }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground">
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="max-w-[160px] truncate">{file.name}</span>
      <span className="text-muted-foreground">{formatSize(file.size)}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${file.name}`}
        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
