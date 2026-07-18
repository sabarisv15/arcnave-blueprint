import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, User } from 'lucide-react';

const ROLE_COLORS = {
  applicant:  { bg: 'rgba(148,163,184,0.1)', color: '#64748b', label: 'Applicant' },
  hod:        { bg: 'rgba(99,102,241,0.1)',  color: '#5B5FEF', label: 'HOD' },
  principal:  { bg: 'rgba(239,68,68,0.1)',   color: '#ef4444', label: 'Principal' },
  system:     { bg: 'rgba(107,114,128,0.1)', color: '#6b7280', label: 'System' },
};

const ACTION_CONFIG = {
  submitted:            { label: 'Submitted Profile',     color: '#64748b', dot: '#94a3b8' },
  hod_approved:         { label: 'HOD Approved',          color: '#5B5FEF', dot: '#5B5FEF' },
  hod_rejected:         { label: 'HOD Rejected',          color: '#ef4444', dot: '#ef4444' },
  pending_principal:    { label: 'Forwarded to Principal',color: '#f59e0b', dot: '#f59e0b' },
  principal_approved:   { label: 'Principal Approved ✓',  color: '#10b981', dot: '#10b981' },
  principal_rejected:   { label: 'Principal Rejected',    color: '#ef4444', dot: '#ef4444' },
};

export function ApprovalTimeline({ history = [] }) {
  if (!history || history.length === 0) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}>
        No approval history yet
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', paddingLeft: 28 }}>
      {/* Vertical line */}
      <div style={{
        position: 'absolute', left: 9, top: 8, bottom: 8,
        width: 2, background: 'linear-gradient(to bottom, rgba(91,95,239,0.3), rgba(91,95,239,0.05))',
        borderRadius: 2
      }} />

      {history.map((entry, i) => {
        const actionCfg = ACTION_CONFIG[entry.action] || { label: entry.action, color: '#64748b', dot: '#94a3b8' };
        const roleCfg = ROLE_COLORS[entry.actor_role] || ROLE_COLORS.system;
        const date = entry.timestamp ? new Date(entry.timestamp) : null;

        return (
          <div key={i} style={{ position: 'relative', marginBottom: i < history.length - 1 ? 20 : 0 }}>
            {/* Dot */}
            <div style={{
              position: 'absolute', left: -28 + 5, top: 6,
              width: 10, height: 10, borderRadius: '50%',
              background: actionCfg.dot, border: '2px solid white',
              boxShadow: `0 0 0 2px ${actionCfg.dot}44`
            }} />

            <div style={{
              background: 'white', border: '1px solid rgba(230,235,242,0.8)',
              borderRadius: 12, padding: '10px 14px'
            }}>
              {/* Action label */}
              <p style={{ fontSize: 12, fontWeight: 800, color: actionCfg.color, marginBottom: 6 }}>
                {actionCfg.label}
              </p>

              {/* Actor info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <User style={{ width: 11, height: 11, color: '#94a3b8' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>
                    {entry.actor_name || entry.actor_username}
                  </span>
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
                  background: roleCfg.bg, color: roleCfg.color, borderRadius: 5, padding: '2px 7px'
                }}>
                  {roleCfg.label}
                </span>
                {date && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock style={{ width: 9, height: 9, color: '#94a3b8' }} />
                    <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>
                      {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} • {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>

              {/* Remarks */}
              {entry.remarks && (
                <p style={{ marginTop: 8, fontSize: 11, color: '#64748b', fontStyle: 'italic', borderLeft: `3px solid ${actionCfg.dot}44`, paddingLeft: 8 }}>
                  "{entry.remarks}"
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AuditLogPanel({ auditLog = [] }) {
  const [expanded, setExpanded] = useState(false);
  const recentLog = expanded ? auditLog : auditLog.slice(-5);

  if (!auditLog || auditLog.length === 0) {
    return (
      <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, padding: '10px 0' }}>
        No edit history yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[...recentLog].reverse().map((entry, i) => {
          const date = entry.timestamp ? new Date(entry.timestamp) : null;
          return (
            <div key={i} style={{
              background: 'white', border: '1px solid rgba(230,235,242,0.8)',
              borderRadius: 10, padding: '10px 14px'
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <User style={{ width: 12, height: 12, color: '#5B5FEF' }} />
                <span style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>
                  {entry.edited_by}
                </span>
                {entry.editor_role && (
                  <span style={{
                    fontSize: 9, fontWeight: 800, textTransform: 'uppercase',
                    background: 'rgba(91,95,239,0.08)', color: '#5B5FEF',
                    borderRadius: 5, padding: '2px 7px'
                  }}>
                    {entry.editor_role}
                  </span>
                )}
                {date && (
                  <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginLeft: 'auto' }}>
                    {date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} {date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              {/* Changes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(entry.changes || []).map((change, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                    <span style={{ fontWeight: 700, color: '#64748b', minWidth: 100, textTransform: 'capitalize' }}>
                      {(change.field || '').replace(/_/g, ' ')}
                    </span>
                    <span style={{ color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {String(change.old_value ?? '—')}
                    </span>
                    <span style={{ color: '#94a3b8' }}>→</span>
                    <span style={{ color: '#10b981', background: 'rgba(16,185,129,0.08)', borderRadius: 4, padding: '1px 6px', fontFamily: 'monospace', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {String(change.new_value ?? '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {auditLog.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 11, fontWeight: 700, color: '#5B5FEF', padding: '4px 0'
          }}
        >
          {expanded ? <ChevronUp style={{ width: 13, height: 13 }} /> : <ChevronDown style={{ width: 13, height: 13 }} />}
          {expanded ? 'Show less' : `Show all ${auditLog.length} edits`}
        </button>
      )}
    </div>
  );
}
