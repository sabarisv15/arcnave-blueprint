import { api, downloadFile, postForFile } from './client';

export const documentsApi = {
  listForStudent: (studentId) => api.get(`/documents?student_id=${studentId}`),
  upload: ({ studentId, docType, fileName, mimeType, fileBase64 }) =>
    api.post('/documents', {
      student_id: studentId, doc_type: docType, file_name: fileName, mime_type: mimeType, file_base64: fileBase64,
    }),
  get: (id) => api.get(`/documents/${id}`),
  download: (id, fallbackFileName) => downloadFile(`/documents/${id}/download`, fallbackFileName),
  review: (id, { status, remarks }) => api.post(`/documents/${id}/review`, { status, remarks }),
  remove: (id) => api.delete(`/documents/${id}`),

  runOcr: (id) => api.post(`/documents/${id}/ocr`),
  listOcr: (id) => api.get(`/documents/${id}/ocr`),

  listTemplates: () => api.get('/documents/templates'),
  uploadTemplate: ({ fileName, mimeType, fileBase64 }) =>
    api.post('/documents/templates', { file_name: fileName, mime_type: mimeType, file_base64: fileBase64 }),
  // Route returns the merged .docx bytes directly (Content-Disposition
  // attachment), not JSON — postForFile mirrors downloadFile's blob/
  // filename handling but for a POST-with-body call.
  mergeTemplate: (id, fields, fallbackFileName) =>
    postForFile(`/documents/${id}/merge`, { fields }, fallbackFileName),

  listInstitutional: ({
    categoryId, academicYearId, departmentId, classId, search,
  } = {}) => {
    const params = new URLSearchParams();
    if (categoryId) params.set('category_id', categoryId);
    if (academicYearId) params.set('academic_year_id', academicYearId);
    if (departmentId) params.set('department_id', departmentId);
    if (classId) params.set('class_id', classId);
    if (search) params.set('search', search);
    const qs = params.toString();
    return api.get(`/documents/institutional${qs ? `?${qs}` : ''}`);
  },
  uploadInstitutional: ({
    title, categoryId, academicYearId, departmentId, classId, fileName, mimeType, fileBase64, documentGroupId, confirmUpload,
  }) => api.post('/documents/institutional', {
    title,
    category_id: categoryId,
    academic_year_id: academicYearId,
    department_id: departmentId,
    class_id: classId,
    file_name: fileName,
    mime_type: mimeType,
    file_base64: fileBase64,
    document_group_id: documentGroupId,
    confirm_upload: confirmUpload,
  }),
  listInstitutionalDepartments: () => api.get('/documents/institutional/departments'),

  // Institutional Documents Phase 3
  listVersions: (documentGroupId) => api.get(`/documents/institutional/versions/${documentGroupId}`),
  compareVersions: (versionAId, versionBId) => api.get(`/documents/institutional/versions/compare?a=${versionAId}&b=${versionBId}`),
  linkLineage: (documentId, previousYearDocumentId) => api.post(`/documents/institutional/${documentId}/lineage`, { previous_year_document_id: previousYearDocumentId }),
  getLineage: (documentId) => api.get(`/documents/institutional/${documentId}/lineage`),
  submitPublish: (documentId) => api.post(`/documents/institutional/${documentId}/publish`),
  submitSupersede: (documentId, reason) => api.post(`/documents/institutional/${documentId}/supersede`, { reason }),
  archive: (documentId) => api.post(`/documents/institutional/${documentId}/archive`),
};
