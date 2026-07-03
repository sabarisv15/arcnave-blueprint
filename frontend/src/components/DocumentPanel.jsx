import React, { useState } from 'react';
import { FileText, Upload, Cpu, CheckCircle2, XCircle, Clock, Eye, X, MoreVertical } from 'lucide-react';

const DOC_TYPES = [
  { key: 'aadhaar',         label: 'Aadhaar Card',          icon: '🪪', required: true },
  { key: 'community_cert',  label: 'Community Certificate', icon: '📋', required: true },
  { key: 'bank_passbook',   label: 'Bank Passbook',         icon: '🏦', required: true },
  { key: 'transfer_cert',   label: 'Transfer Certificate',  icon: '📑', required: false },
  { key: 'birth_cert',      label: 'Birth Certificate',     icon: '📃', required: false },
  { key: 'income_cert',     label: 'Income Certificate',    icon: '💰', required: false },
  { key: 'scholarship_cert',label: 'Scholarship Certificate',icon: '🎓', required: false },
  { key: 'disability_cert', label: 'Disability Certificate',icon: '♿', required: false },
];

const STATUS_CONFIG = {
  not_uploaded:  { label: 'Not Uploaded', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.2)', Icon: Clock },
  uploaded:      { label: 'Uploaded',     color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  border: 'rgba(59,130,246,0.2)',  Icon: FileText },
  ai_extracted:  { label: 'AI Extracted', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.2)',  Icon: Cpu },
  verified:      { label: 'Verified',     color: '#10b981', bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.2)',  Icon: CheckCircle2 },
  rejected:      { label: 'Rejected',     color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   border: 'rgba(239,68,68,0.2)',   Icon: XCircle },
};

export default function DocumentPanel({ studentId, documents = {}, onDocumentUpdate, canVerify = false, canUpload = true }) {
  const [uploading, setUploading] = useState(null);
  const [ocrRunning, setOcrRunning] = useState(null);
  const [ocrResults, setOcrResults] = useState(null); // { docType, extracted_fields, overall_confidence }
  const [activeMenu, setActiveMenu] = useState(null);

  const handleUpload = async (docType, file) => {
    if (!file) return;
    setUploading(docType);
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('doc_type', docType);
      const res = await fetch(`/api/students/${studentId}/documents/upload`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      if (onDocumentUpdate) onDocumentUpdate(docType, data);
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(null);
    }
  };

  const handleOCR = async (docType, file) => {
    if (!file) return;
    setOcrRunning(docType);
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('doc_type', docType);
      const res = await fetch('/api/ai/ocr', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('OCR failed');
      const data = await res.json();
      setOcrResults({ docType, ...data });
      if (onDocumentUpdate) onDocumentUpdate(docType, { status: 'ai_extracted', ai_confidence: data.overall_confidence });
    } catch (err) {
      console.error('OCR error:', err);
    } finally {
      setOcrRunning(null);
    }
  };

  const handleVerify = async (docType, action) => {
    try {
      const res = await fetch(`/api/students/${studentId}/documents/${docType}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!res.ok) throw new Error('Verify failed');
      const data = await res.json();
      if (onDocumentUpdate) onDocumentUpdate(docType, { status: data.status });
    } catch (err) {
      console.error('Verify error:', err);
    }
    setActiveMenu(null);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {DOC_TYPES.map(({ key, label, icon, required }) => {
          const docData = documents[key] || { status: 'not_uploaded' };
          const status = docData.status || 'not_uploaded';
          const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.not_uploaded;
          const { Icon } = cfg;
          const isUploadingThis = uploading === key;
          const isOcrRunningThis = ocrRunning === key;
          const hasFile = docData.file_url;

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
              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20 }}>{icon}</span>
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 800, color: '#1e293b', lineHeight: 1.2 }}>
                      {label}
                      {required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
                    </p>
                    {/* Status badge */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 4,
                      background: 'white', border: `1px solid ${cfg.border}`, borderRadius: 6, padding: '2px 7px' }}>
                      <Icon style={{ width: 9, height: 9, color: cfg.color }} />
                      <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {cfg.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action menu */}
                {canVerify && hasFile && status !== 'not_uploaded' && (
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
                        <button onClick={() => handleVerify(key, 'verify')} style={{
                          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                          padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 12, fontWeight: 700, color: '#10b981'
                        }}>
                          <CheckCircle2 style={{ width: 13, height: 13 }} /> Verify
                        </button>
                        <button onClick={() => handleVerify(key, 'reject')} style={{
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

              {/* AI confidence bar (if extracted) */}
              {docData.ai_confidence && status !== 'not_uploaded' && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>AI Confidence</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: docData.ai_confidence >= 0.9 ? '#10b981' : '#f59e0b' }}>
                      {Math.round(docData.ai_confidence * 100)}%
                    </span>
                  </div>
                  <div style={{ height: 4, background: 'rgba(0,0,0,0.06)', borderRadius: 100, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${docData.ai_confidence * 100}%`,
                      background: docData.ai_confidence >= 0.9 ? '#10b981' : '#f59e0b',
                      borderRadius: 100
                    }} />
                  </div>
                </div>
              )}

              {/* View link */}
              {hasFile && (
                <a href={docData.file_url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#5B5FEF', textDecoration: 'none', marginBottom: 8 }}>
                  <Eye style={{ width: 10, height: 10 }} /> View file
                </a>
              )}

              {/* Action buttons */}
              {canUpload && status === 'not_uploaded' && (
                <label style={{ display: 'block', cursor: 'pointer' }}>
                  <input type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                    onChange={e => handleUpload(key, e.target.files[0])} />
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
                    {isUploadingThis ? 'Uploading...' : 'Upload'}
                  </div>
                </label>
              )}

              {canUpload && status === 'uploaded' && (
                <label style={{ display: 'block', cursor: 'pointer', marginTop: 6 }}>
                  <input type="file" accept="image/*,.pdf" style={{ display: 'none' }}
                    onChange={e => handleOCR(key, e.target.files[0])} />
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: '7px 0', borderRadius: 8,
                    background: 'linear-gradient(135deg, rgba(245,158,11,0.1), rgba(251,191,36,0.1))',
                    border: '1px solid rgba(245,158,11,0.25)',
                    fontSize: 11, fontWeight: 700, color: '#d97706',
                    cursor: isOcrRunningThis ? 'not-allowed' : 'pointer',
                    opacity: isOcrRunningThis ? 0.6 : 1
                  }}>
                    {isOcrRunningThis ? <span className="w-3 h-3 border-2 border-amber-300 border-t-amber-600 rounded-full animate-spin" />
                      : <Cpu style={{ width: 12, height: 12 }} />}
                    {isOcrRunningThis ? 'Extracting...' : 'AI Extract'}
                  </div>
                </label>
              )}
            </div>
          );
        })}
      </div>

      {/* OCR Results Panel */}
      {ocrResults && (
        <div style={{ marginTop: 20, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 14, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 12, fontWeight: 800, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                AI Extraction Results
              </p>
              <p style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Overall confidence: <strong style={{ color: ocrResults.overall_confidence >= 0.9 ? '#10b981' : '#f59e0b' }}>
                  {Math.round(ocrResults.overall_confidence * 100)}%
                </strong>
              </p>
            </div>
            <button onClick={() => setOcrResults(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(245,158,11,0.2)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Field</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748b', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Extracted Value</th>
                <th style={{ textAlign: 'right', padding: '6px 8px', color: '#64748b', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {(ocrResults.extracted_fields || []).map((item, i) => {
                const conf = item.confidence || 0;
                const needsReview = item.needs_review || conf < 0.85;
                const confColor = conf >= 0.9 ? '#10b981' : conf >= 0.85 ? '#f59e0b' : '#ef4444';
                return (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)', background: needsReview ? 'rgba(245,158,11,0.04)' : 'transparent' }}>
                    <td style={{ padding: '8px 8px', fontWeight: 700, color: '#374151', textTransform: 'capitalize' }}>
                      {item.field.replace(/_/g, ' ')}
                    </td>
                    <td style={{ padding: '8px 8px', color: '#1e293b', fontFamily: 'monospace', fontSize: 11 }}>
                      {item.value}
                    </td>
                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, fontWeight: 800, color: confColor
                      }}>
                        {needsReview ? '⚠️' : '✅'} {Math.round(conf * 100)}%
                        {needsReview && <span style={{ fontSize: 9, background: 'rgba(245,158,11,0.1)', borderRadius: 4, padding: '1px 5px' }}>Review</span>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button style={{
              flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: 'linear-gradient(135deg, #5B5FEF, #4F46E5)', color: 'white', border: 'none', cursor: 'pointer'
            }}>
              ✓ Accept All
            </button>
            <button onClick={() => setOcrResults(null)} style={{
              flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: 'white', border: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer'
            }}>
              Review Manually
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
