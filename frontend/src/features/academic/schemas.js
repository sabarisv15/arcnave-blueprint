import { z } from 'zod';

export const academicYearFormSchema = z.object({
  yearLabel: z.string().min(1, 'Year label is required'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
});

export const regulationFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional().or(z.literal('')),
});

export const subjectFormSchema = z.object({
  subjectCode: z.string().min(1, 'Subject code is required'),
  subjectName: z.string().min(1, 'Subject name is required'),
  // curriculumService.createSubject genuinely requires semester —
  // confirmed against the real backend (400 "...and semester are
  // required" when omitted).
  semester: z.coerce.number().int('Semester is required'),
  credits: z.coerce.number().optional().or(z.literal('')),
  lectureHours: z.coerce.number().int().optional().or(z.literal('')),
  tutorialHours: z.coerce.number().int().optional().or(z.literal('')),
  practicalHours: z.coerce.number().int().optional().or(z.literal('')),
  subjectType: z.string().optional().or(z.literal('')),
});

// Mirrors academicService.js's VALID_TIMETABLE_STATUSES.
export const TIMETABLE_STATUSES = ['No Tutor', 'Pending HOD', 'Pending Principal', 'Approved', 'Rejected'];

export const classFormSchema = z.object({
  className: z.string().min(1, 'Class name is required'),
  department: z.string().optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  semester: z.string().optional().or(z.literal('')),
  tutorUserId: z.string().optional().or(z.literal('')),
});

export const timetablePeriodFormSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  hourIndex: z.coerce.number().int().min(1),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
});

export const facultyAllocationFormSchema = z.object({
  periodId: z.string().min(1, 'Period is required'),
  subject: z.string().min(1, 'Subject is required'),
  staffUserId: z.string().min(1, 'Staff user ID is required'),
});

export const substituteAssignmentFormSchema = z.object({
  timetablePeriodId: z.string().min(1, 'Period is required'),
  assignmentDate: z.string().min(1, 'Date is required'),
  originalStaffUserId: z.string().min(1, 'Original staff user ID is required'),
  substituteStaffUserId: z.string().min(1, 'Substitute staff user ID is required'),
  reason: z.string().min(1, 'Reason is required'),
});

export const examDocumentUploadSchema = z.object({
  docType: z.string().min(1, 'Document type is required'),
});

export const assessmentTypeFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  maxMarks: z.coerce.number().positive('Max marks is required'),
});

export const assessmentMarkFormSchema = z.object({
  academicYear: z.string().min(1, 'Academic year is required'),
  subject: z.string().min(1, 'Subject is required'),
  assessmentTypeId: z.string().min(1, 'Assessment type is required'),
  studentId: z.string().min(1, 'Student is required'),
  marksObtained: z.coerce.number().min(0, 'Marks obtained is required'),
});
