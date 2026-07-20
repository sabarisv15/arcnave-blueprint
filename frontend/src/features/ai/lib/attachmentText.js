export const ALLOWED_ATTACHMENT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.log'];
export const MAX_ATTACHMENT_BYTES = 200 * 1024;
const MAX_EXTRACTED_CHARS = 20000;

export function isAllowedAttachment(file) {
  const name = (file?.name || '').toLowerCase();
  return ALLOWED_ATTACHMENT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.readAsText(file);
  });
}

// Folds an attachment's extracted text into the outgoing question as a
// fenced block — POST /ai/ask's { question } contract stays exactly
// as-is, no backend change or new field required.
export function appendAttachmentToQuestion(question, fileName, text) {
  const truncated = text.length > MAX_EXTRACTED_CHARS;
  const body = truncated ? `${text.slice(0, MAX_EXTRACTED_CHARS)}\n[...truncated]` : text;
  return `${question}\n\nAttached file: ${fileName}\n\`\`\`\n${body}\n\`\`\``;
}
