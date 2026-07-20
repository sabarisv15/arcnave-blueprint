import { z } from 'zod';

// Mirrors backend/src/services/aiProviders/index.js's ADAPTERS keys.
export const AI_PROVIDERS = ['nim', 'gemini', 'claude', 'self_hosted'];

export const aiConfigFormSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().optional().or(z.literal('')),
  embeddingModel: z.string().optional().or(z.literal('')),
  baseUrl: z.string().optional().or(z.literal('')),
  apiKey: z.string().optional().or(z.literal('')),
});
