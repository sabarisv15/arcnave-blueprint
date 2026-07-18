import { z } from 'zod';

export const markAttendanceSchema = z.object({
  classId: z.string().min(1, 'Class is required'),
  sessionDate: z.string().min(1, 'Session date is required'),
  hourIndex: z.coerce.number().int().min(1, 'Hour index is required'),
  totalStudents: z.coerce.number().int().min(1, 'Total students is required'),
});

export const correctionRequestSchema = z.object({
  proposedTotalStudents: z.coerce.number().int().min(1, 'Total students is required'),
  reason: z.string().min(1, 'Reason is required'),
});
