import { z } from 'zod';

// Mirrors staffService.createStaff's requirement (userId + fullName)
// plus the rest of STAFF_BODY_FIELDS as optional passthrough.
export const staffFormSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  staffCode: z.string().optional().or(z.literal('')),
  fullName: z.string().min(1, 'Full name is required'),
  gender: z.string().optional().or(z.literal('')),
  dob: z.string().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  designation: z.string().optional().or(z.literal('')),
  qualification: z.string().optional().or(z.literal('')),
  hasPhd: z.boolean().optional(),
  aicteId: z.string().optional().or(z.literal('')),
  joinedYear: z.coerce.number().int().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
});

// Mirrors staffService.provisionHodAccount's requirement (username,
// email, fullName, departmentId) — creates the user account AND the
// staff profile in one call, unlike staffFormSchema above which
// assumes the user already exists.
export const hodAccountFormSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  email: z.string().email('Enter a valid email'),
  fullName: z.string().min(1, 'Full name is required'),
  departmentId: z.string().min(1, 'Department is required'),
  phone: z.string().optional().or(z.literal('')),
  designation: z.string().optional().or(z.literal('')),
  qualification: z.string().optional().or(z.literal('')),
});
