import { api } from './client';

export const assessmentsApi = {
  listTypes: ({ limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', limit);
    if (offset !== undefined) params.set('offset', offset);
    const qs = params.toString();
    return api.get(`/assessment-types${qs ? `?${qs}` : ''}`);
  },
  createType: ({ name, maxMarks }) => api.post('/assessment-types', { name, max_marks: maxMarks }),
  updateType: (id, { name, maxMarks }) => api.put(`/assessment-types/${id}`, { name, max_marks: maxMarks }),

  recordMark: (classId, { academicYear, subject, assessmentTypeId, studentId, marksObtained }) =>
    api.post(`/classes/${classId}/assessment-marks`, {
      academic_year: academicYear, subject, assessment_type_id: assessmentTypeId,
      student_id: studentId, marks_obtained: marksObtained,
    }),
  listMarks: ({ academicYear, departmentId, classId, subject, assessmentTypeId } = {}) => {
    const params = new URLSearchParams();
    if (academicYear) params.set('academic_year', academicYear);
    if (departmentId) params.set('department_id', departmentId);
    if (classId) params.set('class_id', classId);
    if (subject) params.set('subject', subject);
    if (assessmentTypeId) params.set('assessment_type_id', assessmentTypeId);
    return api.get(`/assessment-marks?${params.toString()}`);
  },
  removeMark: (id) => api.delete(`/assessment-marks/${id}`),
};
