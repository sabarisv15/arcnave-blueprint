import { api } from './client';

export const financeApi = {
  listFeeStructures: ({ limit, offset, classId, academicYear } = {}) => {
    const params = new URLSearchParams();
    if (classId && academicYear) {
      params.set('class_id', classId);
      params.set('academic_year', academicYear);
    } else {
      if (limit !== undefined) params.set('limit', limit);
      if (offset !== undefined) params.set('offset', offset);
    }
    const qs = params.toString();
    return api.get(`/finance/fee-structures${qs ? `?${qs}` : ''}`);
  },
  createFeeStructure: ({ academicYear, classId, feeCategory, amount, remarks }) =>
    api.post('/finance/fee-structures', {
      academic_year: academicYear, class_id: classId, fee_category: feeCategory, amount, remarks,
    }),
  updateFeeStructure: (id, { academicYear, classId, feeCategory, amount, remarks }) =>
    api.put(`/finance/fee-structures/${id}`, {
      academic_year: academicYear, class_id: classId, fee_category: feeCategory, amount, remarks,
    }),
  submitFeeStructureApproval: (id) => api.post(`/finance/fee-structures/${id}/submit-approval`),

  markFeePayment: ({ studentId, feeStructureId, status, receiptDocumentId }) =>
    api.post('/finance/fee-payments', {
      student_id: studentId, fee_structure_id: feeStructureId, status, receipt_document_id: receiptDocumentId,
    }),
  listFeePaymentsForStudent: (studentId) => api.get(`/finance/fee-payments?student_id=${studentId}`),

  getScholarshipEligibility: (studentId) => api.get(`/finance/students/${studentId}/scholarship-eligibility`),
  recordScholarshipDecision: (studentId, { schemeName, eligible, reason, supportingDocumentId }) =>
    api.post(`/finance/students/${studentId}/scholarship-decisions`, {
      scheme_name: schemeName, eligible, reason, supporting_document_id: supportingDocumentId,
    }),
  listScholarshipDecisions: (studentId) => api.get(`/finance/students/${studentId}/scholarship-decisions`),
};
