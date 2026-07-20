import { z } from 'zod';

export const loginSchema = z.object({
  collegeCode: z.string().min(1, 'College code is required'),
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const mfaSchema = z.object({
  code: z.string().min(1, 'Code is required'),
});

export const forgotPasswordSchema = z.object({
  collegeCode: z.string().min(1, 'College code is required'),
  email: z.string().email('Enter a valid email'),
});

const PASSWORD_COMPLEXITY_MESSAGE = 'Password must include an uppercase letter, a lowercase letter, a number, and a symbol';

export const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, PASSWORD_COMPLEXITY_MESSAGE)
      .regex(/[a-z]/, PASSWORD_COMPLEXITY_MESSAGE)
      .regex(/[0-9]/, PASSWORD_COMPLEXITY_MESSAGE)
      .regex(/[^A-Za-z0-9]/, PASSWORD_COMPLEXITY_MESSAGE),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const invitationAcceptSchema = z
  .object({
    token: z.string().min(1, 'Invitation token is required'),
    username: z.string().email('Enter a valid email'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, PASSWORD_COMPLEXITY_MESSAGE)
      .regex(/[a-z]/, PASSWORD_COMPLEXITY_MESSAGE)
      .regex(/[0-9]/, PASSWORD_COMPLEXITY_MESSAGE)
      .regex(/[^A-Za-z0-9]/, PASSWORD_COMPLEXITY_MESSAGE),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
