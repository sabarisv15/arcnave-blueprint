import { z } from 'zod';

// Mirrors backend/src/services/studentService.js's ALLOWED_FIELDS.
// rollNo/fullName required (studentService.createStudent's own check);
// everything else optional passthrough. classId is accepted only as an
// assertion of "this is my class" on create — the server resolves the
// real class from the tutor's own assignment regardless.
export const studentFormSchema = z.object({
  rollNo: z.string().min(1, 'Roll number is required'),
  fullName: z.string().min(1, 'Full name is required'),
  gender: z.string().optional().or(z.literal('')),
  entryType: z.string().optional().or(z.literal('')),
  emisNumber: z.string().optional().or(z.literal('')),
  umisNumber: z.string().optional().or(z.literal('')),
  email: z.string().email('Enter a valid email').optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  parentName: z.string().optional().or(z.literal('')),
  parentPhone: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  pincode: z.string().optional().or(z.literal('')),
  annualIncome: z.coerce.number().nonnegative().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
});

// BusinessRules.md Students — Student lifecycle, mirrors
// studentService.js's APPROVAL_REQUIRED_STATES / full lifecycle list.
export const LIFECYCLE_STATUSES = [
  'Applied', 'Admitted', 'Active', 'Suspended', 'Discontinued', 'Debarred', 'Dismissed', 'Graduated', 'Alumni', 'Archived',
];
export const APPROVAL_REQUIRED_STATUSES = ['Discontinued', 'Debarred', 'Dismissed', 'Graduated'];

export const lifecycleChangeSchema = z.object({
  newStatus: z.enum(LIFECYCLE_STATUSES),
  reason: z.string().min(1, 'Reason is required'),
  effectiveDate: z.string().optional().or(z.literal('')),
});

export const transferRequestSchema = z.discriminatedUnion('transferType', [
  z.object({
    transferType: z.literal('internal'),
    destinationClassId: z.string().min(1, 'Destination class is required'),
    reason: z.string().min(1, 'Reason is required'),
  }),
  z.object({
    transferType: z.literal('inter_college'),
    destinationCollegeId: z.string().min(1, 'Destination college code is required'),
    reason: z.string().min(1, 'Reason is required'),
  }),
]);

// Mirrors phoneVerificationService.js's VALID_TARGETS exactly.
export const PHONE_VERIFICATION_TARGETS = ['phone', 'parent_phone'];

export const phoneOtpRequestSchema = z.object({
  target: z.enum(PHONE_VERIFICATION_TARGETS),
});

export const phoneOtpVerifySchema = z.object({
  target: z.enum(PHONE_VERIFICATION_TARGETS),
  code: z.string().min(1, 'Code is required'),
});
