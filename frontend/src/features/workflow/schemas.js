import { z } from 'zod';

// Mirrors notificationService.js's KNOWN_CHANNELS.
export const NOTIFICATION_CHANNELS = ['email', 'sms', 'whatsapp', 'fcm', 'telegram'];

export const notificationDraftFormSchema = z.object({
  channel: z.enum(NOTIFICATION_CHANNELS),
  toAddress: z.string().min(1, 'Recipient is required'),
  subject: z.string().optional().or(z.literal('')),
  body: z.string().min(1, 'Body is required'),
});

export const workflowActionFormSchema = z.object({
  remarks: z.string().optional().or(z.literal('')),
});
