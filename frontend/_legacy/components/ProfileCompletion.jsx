import React from 'react';
import { CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';

const FIELD_LABELS = {
  full_name: 'Full Name',
  roll_no: 'Roll Number',
  dob: 'Date of Birth',
  gender: 'Gender',
  phone: 'Student Phone',
  parent_phone: 'Parent Phone',
  parent_name: 'Parent Name',
  address: 'Address',
  email: 'Email Address',
  community: 'Community / Category',
  mark_10th: '10th Mark',
  aadhaar: 'Aadhaar (Document)',
  community_cert: 'Community Certificate',
  bank_passbook: 'Bank Passbook',
  income_cert: 'Income Certificate',
};

export default function ProfileCompletion({ completion, onFieldClick }) {
  if (!completion) return null;

  const { pct = 0, missing_fields = [] } = completion;

  const color = pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444';
  const bgColor = pct >= 90 ? 'rgba(16,185,129,0.08)' : pct >= 70 ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)';
  const borderColor = pct >= 90 ? 'rgba(16,185,129,0.2)' : pct >= 70 ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)';

  return (
    <div style={{ background: bgColor, border: `1px solid ${borderColor}`, borderRadius: 16, padding: '16px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>
          Profile Completion
        </span>
        <span style={{ fontSize: 20, fontWeight: 900, color }}>{pct}%</span>
      </div>

      {/* Progress Bar */}
      <div style={{ height: 8, background: 'rgba(0,0,0,0.06)', borderRadius: 100, overflow: 'hidden', marginBottom: 12 }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color}, ${color}cc)`,
            borderRadius: 100,
            transition: 'width 0.8s cubic-bezier(0.16,1,0.3,1)',
          }}
        />
      </div>

      {/* Status */}
      {missing_fields.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckCircle2 style={{ width: 14, height: 14, color: '#10b981' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#10b981' }}>All required fields complete!</span>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
            <AlertCircle style={{ width: 13, height: 13, color }} />
            <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {missing_fields.length} item{missing_fields.length > 1 ? 's' : ''} missing
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {missing_fields.map(field => (
              <button
                key={field}
                onClick={() => onFieldClick && onFieldClick(field)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  background: 'white', border: `1px solid ${borderColor}`,
                  borderRadius: 8, padding: '4px 10px',
                  fontSize: 11, fontWeight: 700, color: '#64748b',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = borderColor; e.currentTarget.style.color = '#64748b'; }}
              >
                {FIELD_LABELS[field] || field.replace(/_/g, ' ')}
                <ChevronRight style={{ width: 10, height: 10 }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
