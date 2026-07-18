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
};
