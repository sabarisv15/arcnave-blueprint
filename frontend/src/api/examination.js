import { api } from './client';

export const examinationApi = {
  uploadDocument: (classId, { docType, fileName, mimeType, fileBase64 }) =>
    api.post(`/classes/${classId}/examination-documents`, {
      doc_type: docType, file_name: fileName, mime_type: mimeType, file_base64: fileBase64,
    }),
  listDocuments: (classId) => api.get(`/classes/${classId}/examination-documents`),
  publishTimetable: (classId, documentId) =>
    api.post(`/classes/${classId}/examination-timetable/publish`, { document_id: documentId }),
  getCurrentTimetable: (classId) => api.get(`/classes/${classId}/examination-timetable/current`),
  listTimetableVersions: (classId) => api.get(`/classes/${classId}/examination-timetable/versions`),
};
