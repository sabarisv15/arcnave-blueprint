import { z } from 'zod';

export const askFormSchema = z.object({
  question: z.string().min(1, 'Question is required'),
});

export const invokeToolFormSchema = z.object({
  paramsJson: z.string().refine((val) => {
    if (val.trim() === '') return true;
    try {
      const parsed = JSON.parse(val);
      return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }, 'Must be a valid JSON object, or blank for no params'),
  question: z.string().optional().or(z.literal('')),
});

// Mirrors backend/src/services/aiProviders/index.js's ADAPTERS keys.
export const AI_PROVIDERS = ['nim', 'gemini', 'claude', 'self_hosted'];

export const aiConfigFormSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().optional().or(z.literal('')),
  embeddingModel: z.string().optional().or(z.literal('')),
  baseUrl: z.string().optional().or(z.literal('')),
  apiKey: z.string().optional().or(z.literal('')),
});
