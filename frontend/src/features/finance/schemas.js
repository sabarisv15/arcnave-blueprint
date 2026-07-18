import { z } from 'zod';

export const feeStructureFormSchema = z.object({
  academicYear: z.string().min(1, 'Academic year is required'),
  classId: z.string().min(1, 'Class is required'),
  feeCategory: z.string().min(1, 'Fee category is required'),
  amount: z.coerce.number().positive('Amount is required'),
  remarks: z.string().optional().or(z.literal('')),
});

// Mirrors financeService.js's VALID_FEE_PAYMENT_STATUSES.
export const FEE_PAYMENT_STATUSES = ['paid', 'not_paid'];

export const feePaymentFormSchema = z.object({
  feeStructureId: z.string().min(1, 'Fee structure is required'),
  status: z.enum(FEE_PAYMENT_STATUSES),
});

export const scholarshipDecisionFormSchema = z.object({
  schemeName: z.string().min(1, 'Scheme name is required'),
  eligible: z.enum(['true', 'false']),
  reason: z.string().min(1, 'Reason is required'),
});
