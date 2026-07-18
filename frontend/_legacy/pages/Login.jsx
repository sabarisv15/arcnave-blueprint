import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../App';
import {
  Building2, Lock, User, ShieldAlert, ArrowRight,
  ChevronLeft, Sparkles, GraduationCap
} from 'lucide-react';

const DEMO = [
  { label: 'Faculty',   user: 'staff_cse',  pass: 'staff123',     color: '#5856D6' },
  { label: 'HOD',       user: 'hod_cse',    pass: 'hod123',       color: '#007AFF' },
  { label: 'Principal', user: 'principal',  pass: 'principal123', color: '#FF3B30' },
];

/* Animated canvas aurora on the left */
function AuroraCanvas() {
  const cvRef = useRef(null);
  useEffect(() => {
    const canvas = cvRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let frame = 0;
    let raf;
    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const orbs = [
      { x: 0.25, y: 0.30, r: 0.55, c: [100, 140, 255], spd: 0.0008 },
      { x: 0.75, y: 0.60, r: 0.45, c: [160, 90, 240],  spd: 0.0012 },
      { x: 0.50, y: 0.80, r: 0.40, c: [60, 200, 240],  spd: 0.0010 },
      { x: 0.20, y: 0.70, r: 0.35, c: [255, 160, 100], spd: 0.0007 },
    ];

    const draw = () => {
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // Base gradient
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0,   '#E8EFFF');
      bg.addColorStop(0.5, '#EBE5FF');
      bg.addColorStop(1,   '#E0F0FF');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Animated orbs
      orbs.forEach((o, i) => {
        const t = frame * o.spd + i * 1.5;
        const ox = (o.x + Math.sin(t * 1.1) * 0.12) * W;
        const oy = (o.y + Math.cos(t * 0.9) * 0.10) * H;
        const radius = o.r * Math.min(W, H);

        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
        g.addColorStop(0,   `rgba(${o.c[0]},${o.c[1]},${o.c[2]},0.38)`);
        g.addColorStop(0.5, `rgba(${o.c[0]},${o.c[1]},${o.c[2]},0.16)`);
        g.addColorStop(1,   `rgba(${o.c[0]},${o.c[1]},${o.c[2]},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });

      // Floating particles
      const particleCount = 18;
      for (let i = 0; i < particleCount; i++) {
        const t2 = frame * 0.0004 + i * 0.6;
        const px = ((i / particleCount) + Math.sin(t2 + i) * 0.06) * W;
        const py = ((0.2 + (i * 0.04)) + Math.cos(t2 * 1.3 + i) * 0.08) * H;
        const size = 2 + Math.sin(t2 * 2) * 1.2;
        const alpha = 0.12 + Math.abs(Math.sin(t2 * 1.5)) * 0.15;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(100,130,255,${alpha})`;
        ctx.fill();
      }

      frame++;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);
  return (
    <canvas ref={cvRef} style={{ width: '100%', height: '100%', display: 'block' }} />
  );
}

export default function Login() {
  const { login } = useAuth();
  const [step, setStep] = useState(1);
  const [collegeCode, setCollegeCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // No public "look up a college by code" endpoint exists — step 1
  // just collects the code and advances; a bad code surfaces as a 400
  // "No tenant could be resolved for this request" from the actual
  // login call in step 2 (distinguishable from a 401 wrong-password),
  // not from a confirmation round-trip here. Intentional UX
  // regression vs. the old "College Verified: <name>" step — see
  // .ai/TASK.md.
  const handleCollegeCode = (e) => {
    e.preventDefault();
    setError('');
    if (!collegeCode.trim()) return;
    setStep(2);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password, collegeCode.trim().toLowerCase());
    } catch (err) { setError(err.message || 'Invalid credentials.'); }
    finally { setLoading(false); }
  };

  /* Shared input field style */
  const inputStyle = (icon = true) => ({
    width: '100%',
    paddingLeft: icon ? 44 : 16,
    paddingRight: 16,
    paddingTop: 14,
    paddingBottom: 14,
    background: 'rgba(120,120,128,0.09)',
    border: '1px solid rgba(120,120,128,0.16)',
    borderRadius: 14,
    fontSize: 15,
    fontWeight: 400,
    color: 'var(--label,#000)',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'all 0.25s ease',
    WebkitAppearance: 'none',
    backdropFilter: 'blur(10px)',
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', overflow: 'hidden', position: 'relative' }}>
      {/* Full page aurora */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: 'linear-gradient(145deg,#EDF2FF 0%,#EAE5FF 40%,#E4F2FF 100%)' }} />

      {/* ── LEFT PANEL — Animated Aurora Canvas (desktop only) ── */}
      <div
        className="hidden lg:flex"
        style={{
          flex: 1, position: 'relative', zIndex: 1,
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <AuroraCanvas />

        {/* Floating overlay text */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', padding: 48,
        }}>
          {/* Logo mark */}
          <div style={{
            width: 80, height: 80, borderRadius: 24, marginBottom: 28,
            background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 16px 48px rgba(0,122,255,0.38), 0 4px 16px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.30)',
            backdropFilter: 'blur(20px)',
            animation: 'floatAnim 7s ease-in-out infinite',
          }}>
            <GraduationCap style={{ width: 38, height: 38, color: 'white' }} />
          </div>

          <h1 style={{
            fontSize: 52, fontWeight: 900, letterSpacing: '-0.05em', lineHeight: 1,
            textAlign: 'center', marginBottom: 16,
            background: 'linear-gradient(135deg,#007AFF 0%,#5856D6 45%,#AF52DE 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            ARCNAVE
          </h1>

          <p style={{ fontSize: 18, color: 'rgba(60,60,67,0.55)', fontWeight: 500, letterSpacing: '-0.01em', textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
            Next-generation Campus Operating System for modern institutions
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 32 }}>
            {['🎓 Academic Management','📊 Live Analytics','🤖 AI Assistant','📱 Mobile Ready'].map(f => (
              <span key={f} style={{
                padding: '8px 16px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                background: 'rgba(255,255,255,0.70)', color: 'rgba(60,60,67,0.65)',
                border: '0.5px solid rgba(255,255,255,0.80)',
                backdropFilter: 'blur(16px)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
              }}>
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — Auth Glass Card ── */}
      <div style={{
        width: '100%', maxWidth: 500,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px', position: 'relative', zIndex: 2,
        backdropFilter: 'blur(2px)',
      }}>
        {/* Glass card */}
        <div style={{
          width: '100%', maxWidth: 420,
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(48px) saturate(220%)',
          WebkitBackdropFilter: 'blur(48px) saturate(220%)',
          border: '1px solid rgba(255,255,255,0.70)',
          borderRadius: 28,
          padding: '40px 36px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.12), 0 12px 32px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.92)',
          position: 'relative',
          overflow: 'hidden',
          animation: 'slideUp 0.5s cubic-bezier(0.16,1,0.3,1) both',
        }}>
          {/* Top specular shimmer */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)', pointerEvents: 'none' }} />
          {/* Glass diagonal shimmer */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(145deg, rgba(255,255,255,0.55) 0%, transparent 40%)', pointerEvents: 'none', borderRadius: 'inherit', zIndex: 0 }} />

          <div style={{ position: 'relative', zIndex: 1 }}>

            {/* Mobile logo */}
            <div className="lg:hidden" style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{
                width: 64, height: 64, borderRadius: 20, margin: '0 auto 14px',
                background: 'linear-gradient(135deg, #007AFF, #5856D6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 10px 32px rgba(0,122,255,0.32), inset 0 1px 0 rgba(255,255,255,0.28)',
              }}>
                <GraduationCap style={{ width: 30, height: 30, color: 'white' }} />
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.04em', background: 'linear-gradient(135deg,#007AFF,#5856D6,#AF52DE)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                ARCNAVE
              </h1>
            </div>

            {/* Step indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
              {[{n:1,label:'College'},{n:2,label:'Sign In'}].map(({n,label},i) => (
                <React.Fragment key={n}>
                  {i > 0 && <div style={{ width: 28, height: 1.5, background: step > 1 ? 'rgba(0,122,255,0.35)' : 'rgba(120,120,128,0.20)', borderRadius: 2, transition: 'all 0.4s ease' }} />}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10.5, fontWeight: 800, transition: 'all 0.3s ease',
                      background: step > n ? '#34C759' : step === n ? '#007AFF' : 'rgba(120,120,128,0.15)',
                      color: step >= n ? 'white' : 'rgba(60,60,67,0.40)',
                      boxShadow: step === n ? '0 3px 10px rgba(0,122,255,0.40)' : step > n ? '0 3px 10px rgba(52,199,89,0.40)' : 'none',
                    }}>
                      {step > n ? '✓' : n}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, color: step >= n ? (step === n ? '#007AFF' : '#34C759') : 'rgba(60,60,67,0.40)', transition: 'all 0.3s', letterSpacing: '-0.01em' }}>
                      {label}
                    </span>
                  </div>
                </React.Fragment>
              ))}
            </div>

            {/* ── STEP 1: College Code ── */}
            {step === 1 && (
              <div style={{ animation: 'fadeIn 0.3s ease-out both' }}>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--label,#000)', letterSpacing: '-0.035em', marginBottom: 6 }}>
                  Enter College Code
                </h2>
                <p style={{ fontSize: 14, color: 'rgba(60,60,67,0.55)', lineHeight: 1.55, marginBottom: 26 }}>
                  Each institution has a unique access code issued by ARCNAVE.
                </p>

                {error && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.22)', borderRadius: 14, padding: '11px 15px', marginBottom: 20, animation: 'fadeIn 0.2s ease-out both' }}>
                    <ShieldAlert style={{ width: 16, height: 16, color: '#FF3B30', flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: '#FF3B30', fontWeight: 600 }}>{error}</span>
                  </div>
                )}

                <form onSubmit={handleCollegeCode}>
                  <div style={{ marginBottom: 18 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(60,60,67,0.50)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                      College Code
                    </label>
                    <div style={{ position: 'relative' }}>
                      <Building2 style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 17, height: 17, color: 'rgba(60,60,67,0.38)', pointerEvents: 'none', zIndex: 1 }} />
                      <input
                        type="text" id="college-code"
                        value={collegeCode}
                        onChange={e => setCollegeCode(e.target.value)}
                        placeholder="e.g. demo"
                        style={{ ...inputStyle(), textTransform: 'uppercase', fontFamily: '"JetBrains Mono",monospace', letterSpacing: '0.14em', fontSize: 15, fontWeight: 700 }}
                        onFocus={e => { e.currentTarget.style.borderColor = '#007AFF'; e.currentTarget.style.background = 'rgba(255,255,255,0.90)'; e.currentTarget.style.boxShadow = '0 0 0 3.5px rgba(0,122,255,0.16), 0 2px 12px rgba(0,0,0,0.05)'; }}
                        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(120,120,128,0.16)'; e.currentTarget.style.background = 'rgba(120,120,128,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
                        required autoFocus autoComplete="off"
                      />
                    </div>
                  </div>

                  {/* CTA Button */}
                  <button type="submit" id="college-code-submit" disabled={loading}
                    style={{
                      width: '100%', padding: '15px', borderRadius: 999, border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      background: loading ? 'rgba(0,122,255,0.55)' : 'linear-gradient(160deg, #1E8FFF 0%, #007AFF 55%, #005FCC 100%)',
                      color: 'white', fontSize: 15.5, fontWeight: 700, letterSpacing: '-0.02em',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                      boxShadow: '0 6px 22px rgba(0,122,255,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
                      fontFamily: 'inherit', marginTop: 6, position: 'relative', overflow: 'hidden',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,122,255,0.50), inset 0 1px 0 rgba(255,255,255,0.25)'; }}}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 22px rgba(0,122,255,0.40), inset 0 1px 0 rgba(255,255,255,0.25)'; }}
                    onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                    onMouseUp={e => { e.currentTarget.style.transform = 'none'; }}
                  >
                    {/* Shimmer overlay */}
                    <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(255,255,255,0.20) 0%, transparent 60%)', pointerEvents: 'none', borderRadius: 'inherit' }} />
                    {loading
                      ? <><span style={{ width: 17, height: 17, border: '2.5px solid rgba(255,255,255,0.30)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.75s linear infinite', display: 'inline-block', flexShrink: 0 }} /> Validating...</>
                      : <>Continue <ArrowRight style={{ width: 17, height: 17 }} /></>
                    }
                  </button>
                </form>

                {/* Demo */}
                <div style={{ marginTop: 26, paddingTop: 22, borderTop: '0.5px solid rgba(60,60,67,0.10)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <Sparkles style={{ width: 12, height: 12, color: '#007AFF' }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(60,60,67,0.42)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                      Quick Demo
                    </span>
                  </div>
                  <button onClick={() => setCollegeCode('demo')} style={{
                    padding: '6px 16px', borderRadius: 999, border: '1px solid rgba(88,86,214,0.25)',
                    background: 'rgba(88,86,214,0.09)', color: '#5856D6',
                    fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    letterSpacing: '0.04em', transition: 'all 0.2s ease',
                  }}>
                    DEMO
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: Sign In ── */}
            {step === 2 && (
              <div style={{ animation: 'fadeIn 0.3s ease-out both' }}>
                <button onClick={() => { setStep(1); setError(''); setUsername(''); setPassword(''); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', color: '#007AFF', fontSize: 13.5, fontWeight: 600, marginBottom: 22, fontFamily: 'inherit', padding: 0, letterSpacing: '-0.01em' }}>
                  <ChevronLeft style={{ width: 15, height: 15 }} /> Change college
                </button>

                <h2 style={{ fontSize: 24, fontWeight: 800, color: 'var(--label,#000)', letterSpacing: '-0.035em', marginBottom: 24 }}>
                  Sign in to portal
                </h2>

                {error && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,59,48,0.08)', border: '1px solid rgba(255,59,48,0.22)', borderRadius: 14, padding: '11px 15px', marginBottom: 20 }}>
                    <ShieldAlert style={{ width: 16, height: 16, color: '#FF3B30', flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: '#FF3B30', fontWeight: 600 }}>{error}</span>
                  </div>
                )}

                <form onSubmit={handleLogin}>
                  {/* Username */}
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(60,60,67,0.50)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 9 }}>Username</label>
                    <div style={{ position: 'relative' }}>
                      <User style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 17, height: 17, color: 'rgba(60,60,67,0.38)', pointerEvents: 'none', zIndex: 1 }} />
                      <input type="text" id="login-username" value={username} onChange={e => setUsername(e.target.value)}
                        placeholder="Your username" style={inputStyle()}
                        onFocus={e => { e.currentTarget.style.borderColor = '#007AFF'; e.currentTarget.style.background = 'rgba(255,255,255,0.90)'; e.currentTarget.style.boxShadow = '0 0 0 3.5px rgba(0,122,255,0.16)'; }}
                        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(120,120,128,0.16)'; e.currentTarget.style.background = 'rgba(120,120,128,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
                        required autoComplete="username" autoFocus />
                    </div>
                  </div>

                  {/* Password */}
                  <div style={{ marginBottom: 22 }}>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(60,60,67,0.50)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 9 }}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <Lock style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 17, height: 17, color: 'rgba(60,60,67,0.38)', pointerEvents: 'none', zIndex: 1 }} />
                      <input type="password" id="login-password" value={password} onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••" style={inputStyle()}
                        onFocus={e => { e.currentTarget.style.borderColor = '#007AFF'; e.currentTarget.style.background = 'rgba(255,255,255,0.90)'; e.currentTarget.style.boxShadow = '0 0 0 3.5px rgba(0,122,255,0.16)'; }}
                        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(120,120,128,0.16)'; e.currentTarget.style.background = 'rgba(120,120,128,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
                        required autoComplete="current-password" />
                    </div>
                  </div>

                  {/* Sign In CTA */}
                  <button type="submit" id="login-submit" disabled={loading}
                    style={{
                      width: '100%', padding: '15px', borderRadius: 999, border: 'none',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      background: loading ? 'rgba(0,122,255,0.55)' : 'linear-gradient(160deg, #1E8FFF 0%, #007AFF 55%, #005FCC 100%)',
                      color: 'white', fontSize: 15.5, fontWeight: 700, letterSpacing: '-0.02em',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                      boxShadow: '0 6px 22px rgba(0,122,255,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
                      fontFamily: 'inherit', position: 'relative', overflow: 'hidden', transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,122,255,0.50), inset 0 1px 0 rgba(255,255,255,0.25)'; }}}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 22px rgba(0,122,255,0.40), inset 0 1px 0 rgba(255,255,255,0.25)'; }}
                    onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                    onMouseUp={e => { e.currentTarget.style.transform = 'none'; }}
                  >
                    <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(255,255,255,0.20) 0%, transparent 60%)', pointerEvents: 'none', borderRadius: 'inherit' }} />
                    {loading
                      ? <><span style={{ width: 17, height: 17, border: '2.5px solid rgba(255,255,255,0.30)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 0.75s linear infinite', display: 'inline-block', flexShrink: 0 }} /> Signing in...</>
                      : <>Access Portal <ArrowRight style={{ width: 17, height: 17 }} /></>
                    }
                  </button>
                </form>

                {/* Demo quick login */}
                <div style={{ marginTop: 26, paddingTop: 22, borderTop: '0.5px solid rgba(60,60,67,0.10)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 13 }}>
                    <Sparkles style={{ width: 12, height: 12, color: '#007AFF' }} />
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(60,60,67,0.42)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                      Quick Demo Login
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {DEMO.map(d => (
                      <button key={d.user} type="button"
                        onClick={() => { setUsername(d.user); setPassword(d.pass); }}
                        style={{
                          padding: '7px 16px', borderRadius: 999, border: `1px solid ${d.color}30`,
                          background: `${d.color}0F`, color: d.color,
                          fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                          letterSpacing: '-0.01em', transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${d.color}1E`; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = `${d.color}0F`; e.currentTarget.style.transform = 'none'; }}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  {username && (
                    <p style={{ marginTop: 11, fontSize: 12, color: 'rgba(60,60,67,0.50)', fontWeight: 600 }}>
                      Selected: <span style={{ color: '#007AFF', fontFamily: '"JetBrains Mono",monospace', fontWeight: 700 }}>{username}</span>
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 22 }}>
          <p style={{ fontSize: 12, color: 'rgba(60,60,67,0.38)', fontWeight: 500, marginBottom: 9 }}>
            ARCNAVE Campus OS © {new Date().getFullYear()} — Secure Access
          </p>
          <a href="/register-faculty" style={{ color: '#007AFF', fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em' }}>
            Apply as Faculty →
          </a>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes floatAnim { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-14px); } }
      `}</style>
    </div>
  );
}
