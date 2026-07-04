import React, { useState } from 'react';
import { FileText, Upload, CheckCircle2, XCircle, Clock, Download, MoreVertical, X } from 'lucide-react';

const DOC_TYPES = [
  { key: 'aadhaar',          label: 'Aadhaar Card',           icon: '🪪', required: true },
  { key: 'community_cert',   label: 'Community Certificate',  icon: '📋', required: true },
  { key: 'bank_passbook',    label: 'Bank Passbook',          icon: '🏦', required: true },
  { key: 'transfer_cert',    label: 'Transfer Certificate',   icon: '📑', required: false },
  { key: 'birth_cert',       label: 'Birth Certificate',      icon: '📃', required: false },
  { key: 'income_cert',      label: 'Income Certificate',     icon: '💰', required: false },
  { key: 'scholarship_cert', label: 'Scholarship Certificate', icon: '🎓', required: false },
  { key: 'disability_cert',  label: 'Disability Certificate', icon: '♿', required: false },
  { key: 'photo',            label: 'Student Photo',          icon: '🖼️', required: false },
];

// Real API statuses only (documents.status: 'uploaded' | 'verified' |
// 'rejected' — see the Module 6 migration). 'not_uploaded' is a
// client-only pseudo-state for "no row of this doc_type exists yet",
// never sent to the server.
const STATUS_CONFIG = {
  not_uploaded: { label: 'Not Uploaded', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', Icon: Clock },
  uploaded:     { label: 'Uploaded',     color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.2)',  Icon: FileText },
  verified:     { label: 'Verified',     color: '#10b981', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.2)',  Icon: CheckCircle2 },
  rejected:     { label: 'Rejected',     color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.2)',   Icon: XCircle },
};

// Strips the `data:<mime>;base64,` prefix FileReader.readAsDataURL
// adds — the API wants the raw base64 payload only (POST
// /api/v1/documents' file_base64 field, decoded server-side via
// Buffer.from(..., 'base64')).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DocumentPanel({ studentId, documents = [], accessToken, onDocumentUpdate, canVerify = false, canUpload = true }) {
  const [uploading, setUploading] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);

  // documents is the full list for this student, every version,
  // newest first (GET /api/v1/documents?student_id=... — see
  // documentRepository.findByStudentId's own ORDER BY created_at
  // DESC). Reduced here to "latest row per doc_type" — no unique
  // constraint on (student_id, doc_type) server-side (re-uploads are
  // versions, not overwrites), so the first occurrence per doc_type in
  // a newest-first array is always the current one.
  const latestByType = {};
  for (const doc of documents) {
    if (!latestByType[doc.doc_type]) {
      latestByType[doc.doc_type] = doc;
    }
  }

  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const handleUpload = async (docType, file) => {
    if (!file) return;
    setUploading(docType);
    try {
      const fileBase64 = await fileToBase64(file);
      const res = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({
          student_id: studentId,
          doc_type: docType,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_base64: fileBase64,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
      }
      if (onDocumentUpdate) await onDocumentUpdate();
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(null);
    }
  };

  // The download route requires Bearer auth (requireAuth) — a plain
  // <a href> can't attach that header, so this fetches the bytes
  // itself and opens them via a temporary object URL.
  const handleDownload = async (doc) => {
    setDownloading(doc.id);
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/download`, { headers: authHeaders });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
    } finally {
      setDownloading(null);
    }
  };

  const handleReview = async (doc, status) => {
    try {
      const res = await fetch(`/api/v1/documents/${doc.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Review failed');
      if (onDocumentUpdate) await onDocumentUpdate();
    } catch (err) {
      console.error('Review error:', err);
    }
    setActiveMenu(null);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
      {DOC_TYPES.map(({ key, label, icon, required }) => {
        const doc = latestByType[key];
        const status = doc ? doc.status : 'not_uploaded';
        const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.not_uploaded;
        const { Icon } = cfg;
        const isUploadingThis = uploading === key;
        const isDownloadingThis = doc && downloading === doc.id;

        return (
          <div key={key}
            style={{
              background: cfg.bg,
              border: `1px solid ${cfg.border}`,
              borderRadius: 14,
              padding: '14px 16px',
              position: 'relative',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>{icon}</span>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#1e293b', lineHeight: 1.2 }}>
                    {label}
                    {required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
                  </p>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
                    background: 'white', border: `1px solid ${cfg.border}`, borderRadius: 6, padding: '2px 7px' }}>
                    <Icon style={{ width: 9, height: 9, color: cfg.color }} />
                    <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {cfg.label}
                    </span>
                  </div>
                </div>
              </div>

              {canVerify && doc && status !== 'not_uploaded' && (
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setActiveMenu(activeMenu === key ? null : key)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6 }}>
                    <MoreVertical style={{ width: 14, height: 14, color: '#94a3b8' }} />
                  </button>
                  {activeMenu === key && (
                    <div style={{
                      position: 'absolute', right: 0, top: '100%', zIndex: 50,
                      background: 'white', border: '1px solid #e2e8f0', borderRadius: 10,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '4px 0', minWidth: 130
                    }}>
                      <button onClick={() => handleReview(doc, 'verified')} style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 12, fontWeight: 700, color: '#10b981'
                      }}>
                        <CheckCircle2 style={{ width: 13, height: 13 }} /> Verify
                      </button>
                      <button onClick={() => handleReview(doc, 'rejected')} style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 12, fontWeight: 700, color: '#ef4444'
                      }}>
                        <XCircle style={{ width: 13, height: 13 }} /> Reject
                      </button>
                      <button onClick={() => setActiveMenu(null)} style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, color: '#94a3b8'
                      }}>
                        <X style={{ width: 13, height: 13 }} /> Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {doc && (
              <button onClick={() => handleDownload(doc)} disabled={isDownloadingThis}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#5B5FEF',
                  background: 'none', border: 'none', cursor: isDownloadingThis ? 'not-allowed' : 'pointer', padding: 0, marginBottom: 8 }}>
                <Download style={{ width: 10, height: 10 }} /> {isDownloadingThis ? 'Downloading…' : 'Download'}
              </button>
            )}

            {canUpload && (
              <label style={{ display: 'block', cursor: 'pointer', marginTop: doc ? 0 : undefined }}>
                <input type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                  onChange={e => handleUpload(key, e.target.files[0])} disabled={isUploadingThis} />
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '7px 0', borderRadius: 8,
                  background: 'white', border: '1.5px dashed rgba(91,95,239,0.3)',
                  fontSize: 11, fontWeight: 700, color: '#5B5FEF',
                  cursor: isUploadingThis ? 'not-allowed' : 'pointer',
                  opacity: isUploadingThis ? 0.6 : 1, transition: 'all 0.2s'
                }}>
                  {isUploadingThis ? (
                    <span className="w-3 h-3 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                  ) : <Upload style={{ width: 12, height: 12 }} />}
                  {isUploadingThis ? 'Uploading...' : doc ? 'Upload new version' : 'Upload'}
                </div>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
