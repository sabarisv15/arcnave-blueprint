import { api } from './client';

export const reportsApi = {
  generateStudentExport: (format) => api.post('/reports/student-export', { format }),
  generateAttendance: (format) => api.post('/reports/attendance', { format }),
  generateFinance: (format) => api.post('/reports/finance', { format }),
  generateAssessmentMarks: ({
    format, academicYear, departmentId, classId, subject, assessmentTypeId,
  }) => api.post('/reports/assessment-marks', {
    format,
    academic_year: academicYear,
    department_id: departmentId,
    class_id: classId,
    subject,
    assessment_type_id: assessmentTypeId,
  }),
};
