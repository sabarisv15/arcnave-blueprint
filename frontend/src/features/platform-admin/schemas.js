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

export const invitationActionFormSchema = z.object({
  invitationId: z.string().min(1, 'Invitation ID is required'),
});
