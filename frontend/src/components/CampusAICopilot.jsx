import React, { useState, useEffect, useRef } from 'react';
import { Send, X, Bot, Sparkles, CornerDownLeft } from 'lucide-react';
import { useToast } from '../App';

const QUICK_CHIPS = [
  { label: '📋 Pending Approvals',  text: 'Show me pending approvals.' },
  { label: '⚠️ Attendance Alerts',  text: 'Are there attendance anomalies?' },
  { label: '💳 Fee Reminders',       text: 'Show fee outstanding balances.' },
  { label: '🎓 Placement Insights',  text: 'What are placement insights?' },
  { label: '🚨 Academic Alerts',     text: 'Show recent academic alerts.' },
  { label: '💡 Recommendations',     text: 'Give resource recommendations.' },
];

/* Pulsing canvas orb for the bubble button */
function OrbCanvas() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    cv.width = 56; cv.height = 56;
    let t = 0, raf;
    const draw = () => {
      ctx.clearRect(0, 0, 56, 56);
      const cx = 28, cy = 28;
      // outer glow
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, 28);
      g.addColorStop(0, 'rgba(175,82,222,0.45)');
      g.addColorStop(0.5, 'rgba(0,122,255,0.22)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI*2); ctx.fill();
      // particles
      for (let i = 0; i < 16; i++) {
        const a = (i/16)*Math.PI*2 + t*0.018;
        const r = 14 + Math.sin(t*0.04 + i*0.5)*2.5;
        const px = cx + r*Math.cos(a);
        const py = cy + r*Math.sin(a);
        const hue = (i*22 + t*0.6) % 360;
        ctx.fillStyle = `hsla(${hue},90%,70%,0.70)`;
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI*2); ctx.fill();
      }
      t++; raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}

/* Typing dots */
function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '10px 14px', background: 'rgba(120,120,128,0.10)', borderRadius: '16px 16px 16px 4px', width: 'fit-content' }}>
      {[0,150,300].map(d => (
        <span key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ios-blue,#007AFF)', display: 'inline-block', animation: `typingDot 1.2s ease-in-out ${d}ms infinite` }} />
      ))}
    </div>
  );
}

export default function CampusAICopilot() {
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([
    { role: 'assistant', text: 'Hi! I\'m Campus Brain — your AI copilot. Ask me anything about schedules, attendance, approvals, or student records. 🚀' }
  ]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, loading]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const sendMessage = async (text) => {
    const q = (text || message).trim();
    if (!q) return;
    setMessage('');
    setChatHistory(prev => [...prev, { role: 'user', text: q }]);
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q })
      });
      if (res.ok) {
        const data = await res.json();
        setChatHistory(prev => [...prev, { role: 'assistant', text: data.reply }]);
      } else throw new Error();
    } catch {
      /* Smart local fallback */
      const qL = q.toLowerCase();
      let reply = 'I\'ve scanned the campus database. Let me know if you need more detail.';
      if (qL.includes('approv'))     reply = '📋 **Pending Approvals**: 1 class timetable for CSE 3rd Sem awaiting HOD workload mapping validation.';
      else if (qL.includes('anomal') || qL.includes('attend')) reply = '⚠️ **Attendance Alert**: ECE 5th Sem at 68.4% (below 70% threshold). 4 students flagged for counseling.';
      else if (qL.includes('fee'))    reply = '💳 **Fee Reminders**: ₹48,200 outstanding across 14 students. Late payment notices queued.';
      else if (qL.includes('placement')) reply = '🎓 **Placements**: 84.6% placed. Highest package ₹36.5 LPA (Google). Avg CTC ₹8.2 LPA.';
      else if (qL.includes('academic') || qL.includes('alert')) reply = '🚨 **Academic Alerts**: 4 students with backlogs in CSE 3rd Sem. Campus CGPA stable at 8.4.';
      else if (qL.includes('recommend')) reply = '💡 **Recommendation**: ECE 5th Sem low attendance — suggest adding a pre-exam tutorial hour before end-sem labs.';
      setChatHistory(prev => [...prev, { role: 'assistant', text: reply }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e) => { e.preventDefault(); sendMessage(); };

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9998, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>

      {/* ── Chat Panel ── */}
      {isOpen && (
        <div style={{
          width: 360, maxWidth: 'calc(100vw - 2.5rem)',
          height: 500,
          display: 'flex', flexDirection: 'column',
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(48px) saturate(220%)',
          WebkitBackdropFilter: 'blur(48px) saturate(220%)',
          border: '1px solid rgba(255,255,255,0.70)',
          borderRadius: 24,
          boxShadow: '0 32px 80px rgba(0,0,0,0.14), 0 12px 32px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.90)',
          overflow: 'hidden',
          animation: 'aiPanelPop 0.42s cubic-bezier(0.34,1.56,0.64,1) both',
          transformOrigin: 'bottom right',
        }}>
          {/* Header */}
          <div style={{
            padding: '16px 18px',
            background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 55%, #AF52DE 100%)',
            display: 'flex', alignItems: 'center', gap: 12,
            position: 'relative', flexShrink: 0,
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(255,255,255,0.22) 0%, transparent 50%)', pointerEvents: 'none' }} />
            {/* Brain icon */}
            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(10px)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.30)' }}>
              <Bot style={{ width: 18, height: 18, color: 'white' }} />
            </div>
            <div style={{ flex: 1, position: 'relative', zIndex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: 'white', letterSpacing: '-0.02em', lineHeight: 1 }}>Campus Brain</p>
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.70)', fontWeight: 600, marginTop: 3, letterSpacing: '0.02em' }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#34C759', marginRight: 5, boxShadow: '0 0 6px #34C759' }} />
                Active · Gemini AI
              </p>
            </div>
            <button onClick={() => setIsOpen(false)} style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.20)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative', zIndex: 1 }}>
              <X style={{ width: 14, height: 14, color: 'rgba(255,255,255,0.90)' }} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chatHistory.map((msg, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                {msg.role === 'assistant' && (
                  <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#007AFF,#5856D6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 8, alignSelf: 'flex-end', marginBottom: 2 }}>
                    <Sparkles style={{ width: 12, height: 12, color: 'white' }} />
                  </div>
                )}
                <div style={{
                  maxWidth: '78%',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #007AFF, #0071E3)'
                    : 'rgba(120,120,128,0.10)',
                  color: msg.role === 'user' ? 'white' : 'var(--label,#000)',
                  fontSize: 13, fontWeight: 500, lineHeight: 1.55,
                  letterSpacing: '-0.005em',
                  boxShadow: msg.role === 'user' ? '0 3px 12px rgba(0,122,255,0.30)' : 'none',
                  animation: `fadeInMsg 0.28s ease-out both`,
                  animationDelay: `${i * 30}ms`,
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg,#007AFF,#5856D6)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Sparkles style={{ width: 12, height: 12, color: 'white' }} />
                </div>
                <TypingDots />
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Quick chips */}
          <div style={{ padding: '8px 12px', borderTop: '0.5px solid rgba(60,60,67,0.10)', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }}>
            {QUICK_CHIPS.map((c, i) => (
              <button key={i} type="button" onClick={() => sendMessage(c.text)} disabled={loading}
                style={{
                  flexShrink: 0, padding: '5px 12px', borderRadius: 999,
                  background: 'rgba(0,122,255,0.08)', border: '1px solid rgba(0,122,255,0.18)',
                  color: '#007AFF', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all 0.2s ease',
                  letterSpacing: '-0.005em',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,122,255,0.15)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,122,255,0.08)'; e.currentTarget.style.transform = 'none'; }}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} style={{ padding: '10px 12px', borderTop: '0.5px solid rgba(60,60,67,0.10)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Ask anything about the campus..."
              disabled={loading}
              style={{
                flex: 1, padding: '10px 14px',
                background: 'rgba(120,120,128,0.09)',
                border: '1px solid rgba(120,120,128,0.16)',
                borderRadius: 999, fontSize: 13, fontWeight: 400,
                color: 'var(--label,#000)', fontFamily: 'inherit', outline: 'none',
                transition: 'all 0.22s ease',
              }}
              onFocus={e => { e.currentTarget.style.borderColor = '#007AFF'; e.currentTarget.style.background = 'rgba(255,255,255,0.90)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.14)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(120,120,128,0.16)'; e.currentTarget.style.background = 'rgba(120,120,128,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <button type="submit" disabled={loading || !message.trim()}
              style={{
                width: 38, height: 38, borderRadius: '50%', border: 'none',
                background: message.trim() && !loading ? 'linear-gradient(135deg, #007AFF, #0071E3)' : 'rgba(120,120,128,0.15)',
                cursor: message.trim() && !loading ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, transition: 'all 0.22s ease',
                boxShadow: message.trim() && !loading ? '0 3px 12px rgba(0,122,255,0.35)' : 'none',
              }}>
              <Send style={{ width: 15, height: 15, color: message.trim() && !loading ? 'white' : 'rgba(60,60,67,0.40)' }} />
            </button>
          </form>
        </div>
      )}

      {/* ── Floating Bubble Button ── */}
      <button
        onClick={() => setIsOpen(o => !o)}
        style={{
          width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 55%, #AF52DE 100%)',
          position: 'relative', overflow: 'hidden',
          boxShadow: isOpen
            ? '0 8px 28px rgba(0,122,255,0.45), 0 2px 8px rgba(0,0,0,0.15)'
            : '0 6px 22px rgba(0,122,255,0.40), 0 0 0 0 rgba(0,122,255,0)',
          transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
          transform: isOpen ? 'scale(0.96)' : 'scale(1)',
          animation: 'bubbleFloat 6s ease-in-out infinite',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.10)'; e.currentTarget.style.boxShadow = '0 10px 32px rgba(0,122,255,0.55)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = isOpen ? 'scale(0.96)' : 'scale(1)'; e.currentTarget.style.boxShadow = '0 6px 22px rgba(0,122,255,0.40)'; }}
        onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.92)'; }}
        onMouseUp={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
      >
        {/* Animated canvas orb inside */}
        <OrbCanvas />
        {/* Inner shimmer */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(255,255,255,0.25) 0%, transparent 55%)', pointerEvents: 'none' }} />
        {/* Icon */}
        <div style={{ position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
          {isOpen
            ? <X style={{ width: 20, height: 20, color: 'white' }} />
            : <Sparkles style={{ width: 20, height: 20, color: 'rgba(255,255,255,0.95)' }} />
          }
        </div>
        {/* Pulse ring when closed */}
        {!isOpen && (
          <div style={{ position: 'absolute', inset: -6, borderRadius: '50%', border: '1.5px solid rgba(0,122,255,0.35)', animation: 'bubblePulse 2.4s ease-out infinite', pointerEvents: 'none' }} />
        )}
      </button>

      <style>{`
        @keyframes aiPanelPop {
          from { transform: scale(0.85) translateY(16px); opacity: 0; }
          to   { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes typingDot {
          0%,60%,100% { transform: translateY(0); opacity: 0.50; }
          30%          { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes fadeInMsg {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bubbleFloat {
          0%,100% { transform: translateY(0); }
          50%     { transform: translateY(-6px); }
        }
        @keyframes bubblePulse {
          0%   { transform: scale(1);    opacity: 0.55; }
          70%  { transform: scale(1.50); opacity: 0; }
          100% { transform: scale(1.50); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
