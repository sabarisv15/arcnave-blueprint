import { z } from 'zod';

export const documentUploadFormSchema = z.object({
  docType: z.string().min(1, 'Document type is required'),
});

// Mirrors documentService.js's VALID_REVIEW_STATUSES.
export const REVIEW_STATUSES = ['verified', 'rejected'];

export const documentReviewFormSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  remarks: z.string().optional().or(z.literal('')),
});

export const templateMergeFormSchema = z.object({
  fieldsJson: z.string().min(1, 'Fields are required').refine((val) => {
    try {
      const parsed = JSON.parse(val);
      return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, 'Must be a valid JSON object, e.g. {"full_name": "Jane Doe"}'),
});
