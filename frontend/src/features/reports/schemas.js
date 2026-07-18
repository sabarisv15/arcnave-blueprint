import { z } from 'zod';

// Mirrors reportService.js's GENERATORS keys.
export const REPORT_FORMATS = ['csv', 'pdf', 'xlsx', 'docx'];

export const simpleReportFormSchema = z.object({
  format: z.enum(REPORT_FORMATS),
});

export const assessmentMarksReportFormSchema = z.object({
  format: z.enum(REPORT_FORMATS),
  academicYear: z.string().optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  classId: z.string().optional().or(z.literal('')),
  subject: z.string().optional().or(z.literal('')),
  assessmentTypeId: z.string().optional().or(z.literal('')),
});
