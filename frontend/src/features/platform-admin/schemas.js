import { z } from 'zod';

export const platformLoginFormSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const collegeFormSchema = z.object({
  collegeId: z.string().min(1, 'College ID is required'),
  name: z.string().min(1, 'Name is required'),
  subdomain: z.string().min(1, 'Subdomain is required'),
});

export const invitePrincipalFormSchema = z.object({
  email: z.string().email('A valid email is required'),
});

export const platformSettingsFormSchema = z.object({
  platformName: z.string().min(1, 'Platform name is required'),
  supportEmail: z.union([z.string().email('Enter a valid email'), z.literal('')]).optional(),
  defaultTimezone: z.string().min(1, 'Default timezone is required'),
  dateFormat: z.string().min(1, 'Date format is required'),
  itemsPerPage: z.coerce.number().int().min(5, 'Must be at least 5').max(200, 'Must be at most 200'),
});
