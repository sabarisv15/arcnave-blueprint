import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../App';
import {
  Brain, Send, Plus, Trash2,
  Users, BookOpen, Clock,
  GraduationCap, Sparkles, Copy, RotateCcw,
  Menu, X, Cpu, Database, TrendingUp, Shield, BarChart2, CheckCircle2
} from 'lucide-react';

// ── Simple markdown renderer (no external dependency) ──
function AIMessage({ text }) {
  // Convert markdown to HTML-like JSX
  const renderLine = (line, i) => {
    // Table rows
    if (line.startsWith('|')) {
      return null; // handled separately
    }
    // H3
    if (line.startsWith('### ')) {
      return <h3 key={i} style={{ fontSize: 15, fontWeight: 800, color: 'var(--label,#1e293b)', margin: '16px 0 8px', borderBottom: '0.5px solid var(--sep,rgba(0,0,0,0.08))', paddingBottom: 6 }}>{renderInline(line.slice(4))}</h3>;
    }
    // H4
    if (line.startsWith('#### ')) {
      return <h4 key={i} style={{ fontSize: 13, fontWeight: 800, color: '#374151', margin: '12px 0 6px' }}>{renderInline(line.slice(5))}</h4>;
    }
    // HR
    if (line.trim() === '---' || line.trim() === '═══') {
      return <hr key={i} style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '12px 0' }} />;
    }
    // List items
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return <li key={i} style={{ margin: '4px 0', lineHeight: 1.6 }}>{renderInline(line.slice(2))}</li>;
    }
    // Numbered list
    if (/^\d+\. /.test(line)) {
      return <li key={i} style={{ margin: '4px 0', lineHeight: 1.6 }}>{renderInline(line.replace(/^\d+\. /, ''))}</li>;
    }
    // Blockquote
    if (line.startsWith('> ')) {
      return <blockquote key={i} style={{ borderLeft: '3px solid #5B5FEF', paddingLeft: 14, margin: '8px 0', color: '#64748b', fontStyle: 'italic' }}>{renderInline(line.slice(2))}</blockquote>;
    }
    // Empty line
    if (line.trim() === '') {
      return <div key={i} style={{ height: 6 }} />;
    }
    // Normal paragraph
    return <p key={i} style={{ margin: '4px 0', lineHeight: 1.75 }}>{renderInline(line)}</p>;
  };

  const renderInline = (text) => {
    // Split by bold/italic/code markers
    const parts = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      const italicMatch = remaining.match(/\*(.+?)\*/);
      const codeMatch = remaining.match(/`(.+?)`/);

      const matches = [boldMatch, italicMatch, codeMatch].filter(Boolean);
      if (matches.length === 0) {
        parts.push(<span key={key++}>{remaining}</span>);
        break;
      }

      // Find earliest match
      const earliest = matches.reduce((a, b) => a.index < b.index ? a : b);

      if (earliest.index > 0) {
        parts.push(<span key={key++}>{remaining.slice(0, earliest.index)}</span>);
      }

      if (earliest === boldMatch) {
        parts.push(<strong key={key++} style={{ fontWeight: 800, color: '#1e293b' }}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(earliest.index + boldMatch[0].length);
      } else if (earliest === italicMatch) {
        parts.push(<em key={key++} style={{ color: '#64748b' }}>{italicMatch[1]}</em>);
        remaining = remaining.slice(earliest.index + italicMatch[0].length);
      } else {
        parts.push(<code key={key++} style={{ background: 'rgba(91,95,239,0.08)', borderRadius: 5, padding: '1px 6px', fontSize: 12, fontFamily: 'monospace', color: '#5B5FEF' }}>{codeMatch[1]}</code>);
        remaining = remaining.slice(earliest.index + codeMatch[0].length);
      }
    }
    return parts;
  };

  // Parse tables
  const renderContent = () => {
    const lines = text.split('\n');
    const result = [];
    let i = 0;
    let inList = false;
    let listItems = [];

    const flushList = () => {
      if (listItems.length > 0) {
        result.push(<ul key={`list-${i}`} style={{ paddingLeft: 18, margin: '8px 0' }}>{listItems}</ul>);
        listItems = [];
        inList = false;
      }
    };

    while (i < lines.length) {
      const line = lines[i];

      // Detect table block
      if (line.startsWith('|')) {
        flushList();
        const tableLines = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }
        // Parse table
        const rows = tableLines.filter(r => !r.match(/^\|[\s\-|:]+\|$/));
        const headers = rows[0]?.split('|').slice(1, -1).map(h => h.trim()) || [];
        const bodyRows = rows.slice(1);

        result.push(
          <div key={`table-${i}`} style={{ overflowX: 'auto', margin: '12px 0', borderRadius: 12, border: '1px solid rgba(91,95,239,0.12)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ background: 'linear-gradient(135deg, rgba(91,95,239,0.06), rgba(79,70,229,0.04))' }}>
                <tr>
                  {headers.map((h, hi) => (
                    <th key={hi} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 800, fontSize: 11, color: '#5B5FEF', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(91,95,239,0.12)' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyRows.map((row, ri) => {
                  const cells = row.split('|').slice(1, -1).map(c => c.trim());
                  return (
                    <tr key={ri} style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                      {cells.map((cell, ci) => (
                        <td key={ci} style={{ padding: '9px 14px', color: '#374151', fontWeight: 500 }}>
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      // List items
      if (line.startsWith('- ') || line.startsWith('* ') || /^\d+\. /.test(line)) {
        inList = true;
        listItems.push(renderLine(line, `li-${i}`));
        i++;
        continue;
      }

      flushList();
      result.push(renderLine(line, i));
      i++;
    }

    flushList();
    return result;
  };

  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.75, color: '#1e293b' }}>
      {renderContent()}
    </div>
  );
}

// Typing dots
function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '12px 16px' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: '50%',
          background: 'linear-gradient(135deg, #5B5FEF, #4F46E5)',
          animation: 'cbBounce 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`
        }} />
      ))}
      <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Campus Brain is thinking...</span>
    </div>
  );
}

const QUICK_PROMPTS = {
  principal: [
    { icon: '📊', label: 'College Overview', text: 'Give me a complete college overview with all key statistics.' },
    { icon: '⚠️', label: 'Low Attendance', text: 'Show me all students below 75% attendance across all departments.' },
    { icon: '👨‍🏫', label: 'Faculty List', text: 'List all faculty members with their departments and designations.' },
    { icon: '✅', label: 'Pending Approvals', text: 'What faculty profile requests are waiting for my approval?' },
    { icon: '📋', label: 'Timetable Status', text: 'Which classes have pending timetable approvals?' },
    { icon: '🏘️', label: 'Community Report', text: 'Give me a breakdown of student community and gender distribution.' },
    { icon: '📈', label: 'Dept Comparison', text: 'Compare attendance statistics across all departments.' },
    { icon: '🎓', label: 'Scholarships', text: 'How many students are on scholarship? List them.' },
  ],
  hod: [
    { icon: '📊', label: 'Dept Overview', text: 'Give me an overview of my department statistics.' },
    { icon: '⚠️', label: 'Low Attendance', text: 'Show students below 75% in my department.' },
    { icon: '👨‍🏫', label: 'My Faculty', text: 'List all faculty in my department and their workload.' },
    { icon: '✅', label: 'Pending Approvals', text: 'Are there faculty requests waiting for my review?' },
    { icon: '📋', label: 'Timetable Status', text: 'Which class timetables in my department need approval?' },
    { icon: '🎯', label: 'At-Risk Students', text: 'Who are the at-risk students in my department?' },
    { icon: '📝', label: 'Sem Marks', text: 'Summarize semester marks for students in my department.' },
    { icon: '🏘️', label: 'Demographics', text: 'Show community and gender breakdown for my department.' },
  ],
  staff: [
    { icon: '📊', label: 'My Class', text: 'Give me an overview of my class.' },
    { icon: '⚠️', label: 'Low Attendance', text: 'Which students in my class have attendance below 75%?' },
    { icon: '📋', label: 'Timetable', text: 'What does my class timetable look like?' },
    { icon: '🎯', label: 'At-Risk', text: 'Which students in my class need attention?' },
  ]
};

const SUGGESTION_CHIPS = [
  'Show students below 75% attendance',
  'Give me a college overview',
  'List pending approvals',
  'Compare department attendance',
];

export default function CampusBrain() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([
    { id: Date.now(), title: 'New conversation', messages: [] }
  ]);
  const [activeConvId, setActiveConvId] = useState(conversations[0].id);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [snapshotSummary, setSnapshotSummary] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const activeConv = conversations.find(c => c.id === activeConvId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConv?.messages, loading]);

  const updateConv = useCallback((id, updater) => {
    setConversations(prev => prev.map(c => c.id === id ? updater(c) : c));
  }, []);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || loading) return;
    const convId = activeConvId;
    const userMsg = { id: Date.now(), role: 'user', text: text.trim(), ts: new Date().toISOString() };

    updateConv(convId, c => ({
      ...c,
      title: c.messages.length === 0 ? text.trim().slice(0, 42) + (text.length > 42 ? '…' : '') : c.title,
      messages: [...c.messages, userMsg]
    }));

    setInput('');
    setLoading(true);

    try {
      const conv = conversations.find(c => c.id === convId);
      const history = (conv?.messages || []).slice(-10).map(m => ({ role: m.role, text: m.text }));

      const res = await fetch('/api/ai/campus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), history })
      });

      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      if (data.snapshot_summary) setSnapshotSummary(data.snapshot_summary);

      const aiMsg = { id: Date.now() + 1, role: 'assistant', text: data.reply, ts: new Date().toISOString() };
      updateConv(convId, c => ({ ...c, messages: [...c.messages, aiMsg] }));
    } catch (err) {
      const errMsg = { id: Date.now() + 1, role: 'assistant', text: '⚠️ Could not reach Campus Brain. Please check if the backend server is running on port 5000.', ts: new Date().toISOString(), isError: true };
      updateConv(convId, c => ({ ...c, messages: [...c.messages, errMsg] }));
    } finally {
      setLoading(false);
    }
  }, [loading, activeConvId, conversations, updateConv]);

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  const newConversation = () => {
    const conv = { id: Date.now(), title: 'New conversation', messages: [] };
    setConversations(prev => [conv, ...prev]);
    setActiveConvId(conv.id);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const deleteConversation = (id) => {
    const remaining = conversations.filter(c => c.id !== id);
    const fallback = remaining.length > 0 ? remaining : [{ id: Date.now(), title: 'New conversation', messages: [] }];
    setConversations(fallback);
    if (activeConvId === id) setActiveConvId(fallback[0].id);
  };

  const copyMessage = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const quickPrompts = QUICK_PROMPTS[user?.role] || QUICK_PROMPTS.staff;
  const isEmpty = !activeConv || activeConv.messages.length === 0;

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'transparent', overflow: 'hidden', fontFamily: "-apple-system,'SF Pro Display','Inter',BlinkMacSystemFont,sans-serif" }}>

      {/* ── SIDEBAR ── */}
      <div style={{ width: sidebarOpen ? 258 : 0, minWidth: sidebarOpen ? 258 : 0, background: 'var(--glass,rgba(255,255,255,0.80))', backdropFilter: 'blur(32px) saturate(180%)', WebkitBackdropFilter: 'blur(32px) saturate(180%)', borderRight: '0.5px solid var(--sep,rgba(60,60,67,0.10))', display: 'flex', flexDirection: 'column', transition: 'all 0.28s cubic-bezier(0.16,1,0.3,1)', overflow: 'hidden', flexShrink: 0 }}>

        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid rgba(230,235,242,0.9)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(0,122,255,0.30)', flexShrink: 0 }}>
              <Brain style={{ width: 18, height: 18, color: 'white' }} />
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 900, color: '#1e293b' }}>Campus Brain</p>
              <p style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>AI · Connected to DB</p>
            </div>
          </div>

          <button onClick={newConversation} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 12, cursor: 'pointer', background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,122,255,0.18)', fontSize: 12, fontWeight: 700, color: '#007AFF', transition: 'all 0.2s', fontFamily: 'inherit' }}>
            <Plus style={{ width: 14, height: 14 }} /> New Conversation
          </button>
        </div>

        {/* Live DB Stats */}
        {snapshotSummary && (
          <div style={{ margin: '12px 12px 0', background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 10, padding: '8px 12px' }}>
            <p style={{ fontSize: 9, fontWeight: 800, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              📡 Live DB Context
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {[
                { label: 'Students', value: snapshotSummary.students },
                { label: 'Faculty', value: snapshotSummary.faculty },
                { label: 'Classes', value: snapshotSummary.classes },
                { label: 'Low Att.', value: snapshotSummary.low_attendance || 0, warn: (snapshotSummary.low_attendance || 0) > 0 },
              ].map(item => (
                <div key={item.label} style={{ textAlign: 'center', background: 'white', borderRadius: 6, padding: '4px 6px' }}>
                  <p style={{ fontSize: 15, fontWeight: 900, color: item.warn ? '#ef4444' : '#1e293b' }}>{item.value}</p>
                  <p style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600 }}>{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Conversation List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
          <p style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 8px', marginBottom: 6 }}>Recent Chats</p>
          {conversations.map(conv => (
            <div key={conv.id} onClick={() => setActiveConvId(conv.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderRadius: 11, cursor: 'pointer', marginBottom: 2, background: activeConvId === conv.id ? 'rgba(0,122,255,0.09)' : 'transparent', border: `1px solid ${activeConvId === conv.id ? 'rgba(0,122,255,0.18)' : 'transparent'}`, transition: 'all 0.15s' }}>
              <BookOpen style={{ width: 13, height: 13, color: activeConvId === conv.id ? '#5B5FEF' : '#94a3b8', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: activeConvId === conv.id ? '#007AFF' : 'var(--label-2,#374151)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conv.title}</span>
              {conversations.length > 1 && (
                <button onClick={e => { e.stopPropagation(); deleteConversation(conv.id); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: 0.5, borderRadius: 4 }}>
                  <Trash2 style={{ width: 11, height: 11, color: '#ef4444' }} />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* User Footer */}
        <div style={{ padding: '12px 16px', borderTop: '0.5px solid var(--sep,rgba(60,60,67,0.10))', background: 'rgba(120,120,128,0.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #007AFF, #5856D6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: 'white', boxShadow: '0 2px 8px rgba(0,122,255,0.28)' }}>
              {(user?.name || user?.username || 'U')[0].toUpperCase()}
            </div>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: '#1e293b' }}>{user?.name || user?.username}</p>
              <p style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, textTransform: 'capitalize' }}>{user?.role}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN AREA ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top bar */}
        <div style={{ padding: '14px 20px', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(32px) saturate(180%)', WebkitBackdropFilter: 'blur(32px) saturate(180%)', borderBottom: '0.5px solid var(--sep,rgba(60,60,67,0.10))', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, color: '#64748b' }}>
            {sidebarOpen ? <X style={{ width: 18, height: 18 }} /> : <Menu style={{ width: 18, height: 18 }} />}
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg, #007AFF, #5856D6)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(0,122,255,0.28)' }}>
              <Brain style={{ width: 16, height: 16, color: 'white' }} />
            </div>
            <div>
              <p style={{ fontSize: 14, fontWeight: 800, color: '#1e293b' }}>Campus Brain</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                <p style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>
                  Live DB · {user?.role === 'principal' ? 'Full College' : user?.role === 'hod' ? `${user?.department} Dept` : 'Class'} Access
                </p>
              </div>
            </div>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '4px 10px' }}>
            <Cpu style={{ width: 12, height: 12, color: '#f59e0b' }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: '#92400e' }}>Gemini 2.5 Flash</span>
          </div>

          <a href={user?.role === 'principal' ? '/dashboard/principal' : user?.role === 'hod' ? '/dashboard/hod' : '/dashboard/staff/tutor-class'} style={{ textDecoration: 'none' }}>
            <button style={{ background: 'none', border: '1px solid rgba(230,235,242,0.9)', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>← Dashboard</button>
          </a>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {isEmpty ? (
            <div style={{ maxWidth: 720, margin: '0 auto', paddingTop: 52, paddingBottom: 40 }}>
              {/* Hero */}
              <div style={{ textAlign: 'center', marginBottom: 44 }}>
                <div style={{ width: 72, height: 72, borderRadius: 22, margin: '0 auto 20px', background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 55%, #AF52DE 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 14px 44px rgba(0,122,255,0.30)' }}>
                  <Brain style={{ width: 36, height: 36, color: 'white' }} />
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 900, color: '#1e293b', marginBottom: 8 }}>Campus Brain</h1>
                <p style={{ fontSize: 14, color: '#64748b', fontWeight: 600, maxWidth: 480, margin: '0 auto' }}>
                  Your institutional AI — connected to the entire college database. Ask anything about students, attendance, faculty, approvals, and analytics.
                </p>
              </div>

              {/* Quick prompts grid */}
              <div style={{ marginBottom: 36 }}>
                <p style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Quick queries for your role</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                  {quickPrompts.map((qp, i) => (
                    <button key={i} onClick={() => sendMessage(qp.text)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px', borderRadius: 16, cursor: 'pointer', textAlign: 'left', background: 'var(--glass,rgba(255,255,255,0.80))', border: '1px solid var(--glass-border,rgba(255,255,255,0.55))', boxShadow: 'var(--glass-shadow,0 4px 16px rgba(0,0,0,0.06))', transition: 'all 0.22s ease', backdropFilter: 'blur(16px)', fontFamily: 'inherit' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,122,255,0.22)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,122,255,0.12)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--glass-border,rgba(255,255,255,0.55))'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'var(--glass-shadow)'; }}>
                      <span style={{ fontSize: 22 }}>{qp.icon}</span>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginBottom: 3 }}>{qp.label}</p>
                        <p style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, lineHeight: 1.4 }}>{qp.text}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Capability badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {[
                  { icon: '👥', label: 'Student Analytics' },
                  { icon: '📊', label: 'Attendance Reports' },
                  { icon: '🎓', label: 'Academic Insights' },
                  { icon: '✅', label: 'Approval Tracking' },
                  { icon: '📈', label: 'Trend Analysis' },
                  { icon: '🗄️', label: 'Live DB Connected' },
                ].map((badge, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'white', border: '1px solid rgba(91,95,239,0.12)', borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#5B5FEF' }}>
                    {badge.icon} {badge.label}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 800, margin: '0 auto', paddingTop: 24, paddingBottom: 20 }}>
              {activeConv.messages.map((msg, i) => (
                <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 20, alignItems: 'flex-start', gap: 12 }}>
                  {msg.role === 'assistant' && (
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #5B5FEF, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <Brain style={{ width: 17, height: 17, color: 'white' }} />
                    </div>
                  )}

                  <div style={{ maxWidth: msg.role === 'user' ? '68%' : '88%', minWidth: 80 }}>
                    {msg.role === 'user' ? (
                      <div style={{ background: 'linear-gradient(135deg, #007AFF, #0071E3)', color: 'white', borderRadius: '18px 18px 4px 18px', padding: '12px 18px', fontSize: 13.5, fontWeight: 600, lineHeight: 1.6, boxShadow: '0 4px 16px rgba(0,122,255,0.28)' }}>
                        {msg.text}
                      </div>
                    ) : (
                      <div style={{ background: 'var(--glass,rgba(255,255,255,0.85))', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: msg.isError ? '1px solid rgba(255,59,48,0.22)' : '1px solid var(--glass-border,rgba(255,255,255,0.55))', borderRadius: '4px 18px 18px 18px', padding: '16px 20px', boxShadow: 'var(--glass-shadow,0 4px 16px rgba(0,0,0,0.06))' }}>
                        <AIMessage text={msg.text} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.04)' }}>
                          <button onClick={() => copyMessage(msg.text, msg.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: copiedId === msg.id ? '#10b981' : '#94a3b8' }}>
                            {copiedId === msg.id ? <CheckCircle2 style={{ width: 12, height: 12 }} /> : <Copy style={{ width: 12, height: 12 }} />}
                            {copiedId === msg.id ? 'Copied!' : 'Copy'}
                          </button>
                          <button onClick={() => { const prevUser = activeConv.messages.slice(0, i).reverse().find(m => m.role === 'user'); if (prevUser) sendMessage(prevUser.text); }} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, color: '#94a3b8' }}>
                            <RotateCcw style={{ width: 12, height: 12 }} /> Retry
                          </button>
                          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#cbd5e1', fontWeight: 500 }}>
                            {msg.ts ? new Date(msg.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, fontSize: 14, fontWeight: 800, color: '#5B5FEF' }}>
                      {(user?.name || user?.username || 'U')[0].toUpperCase()}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg, #5B5FEF, #4F46E5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Brain style={{ width: 17, height: 17, color: 'white' }} />
                  </div>
                  <div style={{ background: 'white', border: '1px solid rgba(230,235,242,0.9)', borderRadius: '4px 18px 18px 18px', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                    <TypingDots />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── INPUT BAR ── */}
        <div style={{ padding: '12px 20px 18px', background: 'rgba(255,255,255,0.90)', backdropFilter: 'blur(32px) saturate(180%)', WebkitBackdropFilter: 'blur(32px) saturate(180%)', borderTop: '0.5px solid var(--sep,rgba(60,60,67,0.10))', flexShrink: 0 }}>
          <div style={{ maxWidth: 800, margin: '0 auto' }}>
            {!isEmpty && !loading && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
                {SUGGESTION_CHIPS.map((s, i) => (
                  <button key={i} onClick={() => sendMessage(s)} style={{ flexShrink: 0, background: 'rgba(0,122,255,0.07)', border: '1px solid rgba(0,122,255,0.18)', borderRadius: 999, padding: '5px 12px', fontSize: 11, fontWeight: 700, color: '#007AFF', cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s' }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, background: 'var(--glass,rgba(255,255,255,0.80))', backdropFilter: 'blur(20px)', border: '1.5px solid rgba(0,122,255,0.22)', borderRadius: 18, padding: '12px 16px', boxShadow: '0 4px 20px rgba(0,122,255,0.10)', transition: 'all 0.22s ease' }}>
                <Sparkles style={{ width: 16, height: 16, color: '#007AFF', flexShrink: 0, marginBottom: 3 }} />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                  placeholder="Ask anything about your college — students, attendance, faculty, approvals, reports..."
                  disabled={loading}
                  rows={1}
                  style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: 13.5, fontWeight: 500, color: '#1e293b', lineHeight: 1.6, background: 'transparent', maxHeight: 120, overflowY: 'auto', fontFamily: 'inherit' }}
                />
                <button type="submit" disabled={loading || !input.trim()} style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, background: loading || !input.trim() ? 'rgba(0,122,255,0.18)' : 'linear-gradient(135deg, #007AFF, #0071E3)', border: 'none', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', boxShadow: loading || !input.trim() ? 'none' : '0 4px 14px rgba(0,122,255,0.35)' }}>
                  <Send style={{ width: 16, height: 16, color: 'white' }} />
                </button>
              </div>
              <p style={{ textAlign: 'center', fontSize: 10, color: '#cbd5e1', fontWeight: 500, marginTop: 7 }}>
                Campus Brain reads live from your college database · Press Enter to send · Shift+Enter for new line
              </p>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cbBounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.6; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
